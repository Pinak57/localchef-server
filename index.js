const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// ─────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────
app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

// ─────────────────────────────────────────
// MONGODB CONNECTION
// ─────────────────────────────────────────
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

// ─────────────────────────────────────────
// JWT MIDDLEWARE
// ─────────────────────────────────────────
function verifyJWT(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).send({ message: "Unauthorized: No token provided" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).send({ message: "Forbidden: Invalid token" });
    req.user = decoded;
    next();
  });
}

// ─────────────────────────────────────────
// ROLE MIDDLEWARE
// ─────────────────────────────────────────
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).send({ message: "Access denied: Insufficient role" });
    }
    next();
  };
}

// ─────────────────────────────────────────
// MAIN FUNCTION
// ─────────────────────────────────────────
async function run() {
  try {
    await client.connect();
    console.log("✅ Successfully connected to MongoDB!");

    const db = client.db("LocalChefBazaar");

    // Collections
    const usersCollection     = db.collection("users");
    const mealsCollection     = db.collection("meals");
    const ordersCollection    = db.collection("orders");
    const reviewsCollection   = db.collection("reviews");
    const favoritesCollection = db.collection("favorites");
    const requestsCollection  = db.collection("requests");
    const paymentsCollection  = db.collection("payments");

    // ─────────────────────────────────────────
    // ROOT
    // ─────────────────────────────────────────
    app.get("/", (req, res) => {
      res.send("🍽️ LocalChefBazaar Server is Running!");
    });

    // =========================================
    // AUTH ROUTES
    // =========================================

    // Register user (called after Firebase creates the user)
    app.post("/auth/register", async (req, res) => {
      try {
        const { name, email, address, profileImage } = req.body;

        const existing = await usersCollection.findOne({ email });
        if (existing) {
          return res.status(400).send({ message: "User already exists" });
        }
        const newUser = {
          name,
          email,
          address,
          profileImage,
          role: "user",     // default role
          status: "active", // default status
          chefId: null,     // only set when approved as chef
          createdAt: new Date().toISOString(),
        };

        await usersCollection.insertOne(newUser);
        res.status(201).send({ success: true, user: newUser });
      } catch (err) {
        res.status(500).send({ message: "Registration failed", error: err.message });
      }
    });

    // Login - verify user exists and issue JWT
    app.post("/auth/login", async (req, res) => {
      try {
        const { email } = req.body;

        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(401).send({ message: "User not found. Please register first." });
        }

        const token = jwt.sign(
          { email: user.email, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );

        res.send({ success: true, user, token });
      } catch (err) {
        res.status(500).send({ message: "Login failed", error: err.message });
      }
    });

    // Logout
    app.post("/auth/logout", (req, res) => {
      res.send({ success: true, message: "Logged out successfully" });
    });

    // Get currently logged-in user info
    app.get("/auth/me", verifyJWT, async (req, res) => {
      try {
        const user = await usersCollection.findOne({ email: req.user.email });
        if (!user) return res.status(404).send({ message: "User not found" });
        res.send({ success: true, user });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch user" });
      }
    });

    // =========================================
    // PUBLIC ROUTES (no login required)
    // =========================================

    // Get all meals with pagination, search, sort
    // app.get("/meals", async (req, res) => {
    //   try {
    //     const page   = parseInt(req.query.page)  || 1;
    //     const limit  = parseInt(req.query.limit) || 10;
    //     const search = req.query.search || "";
    //     const sort   = req.query.sort; // "asc" or "desc"

    //     const query = search
    //       ? { foodName: { $regex: search, $options: "i" } }
    //       : {};

    //     const sortOption = sort ? { price: sort === "asc" ? 1 : -1 } : {};

    //     const totalMeals = await mealsCollection.countDocuments(query);
    //     const meals = await mealsCollection
    //       .find(query)
    //       .sort(sortOption)
    //       .skip((page - 1) * limit)
    //       .limit(limit)
    //       .toArray();

    //     res.send({ success: true, meals, totalMeals });
    //   } catch (err) {
    //     res.status(500).send({ message: "Failed to fetch meals" });
    //   }
    // });

    // Get single meal by ID
    app.get("/meals/:id", async (req, res) => {
      try {
        const meal = await mealsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!meal) return res.status(404).send({ message: "Meal not found" });
        res.send({ success: true, meal });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch meal details" });
      }
    });

    // Get all reviews (for homepage)
    app.get("/reviews", async (req, res) => {
      try {
        const reviews = await reviewsCollection.find().toArray();
        res.send({ success: true, reviews });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    // Get reviews for a specific meal
    app.get("/reviews/meal/:mealId", async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find({ foodId: req.params.mealId })
          .toArray();
        res.send({ success: true, reviews });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch meal reviews" });
      }
    });

    // =========================================
    // USER DASHBOARD ROUTES (role: "user")
    // =========================================

    // Get user profile
    app.get("/user/profile", verifyJWT, authorizeRoles("user"), async (req, res) => {
      try {
        const user = await usersCollection.findOne({ email: req.user.email });
        res.send({ success: true, user });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch profile" });
      }
    });

    // Get user's all orders
    app.get("/user/orders", verifyJWT, authorizeRoles("user"), async (req, res) => {
      try {
        const orders = await ordersCollection
          .find({ userEmail: req.user.email })
          .toArray();
        res.send({ success: true, orders });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch orders" });
      }
    });

    // Get user's all reviews
    app.get("/user/reviews", verifyJWT, authorizeRoles("user"), async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find({ reviewerEmail: req.user.email })
          .toArray();
        res.send({ success: true, reviews });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    // Get user's favorite meals
    app.get("/user/favorites", verifyJWT, authorizeRoles("user"), async (req, res) => {
      try {
        const favorites = await favoritesCollection
          .find({ userEmail: req.user.email })
          .toArray();
        res.send({ success: true, favorites });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch favorites" });
      }
    });

    // Place an order
    app.post("/orders", verifyJWT, authorizeRoles("user"), async (req, res) => {
      try {
        // Block fraud users
        const userDoc = await usersCollection.findOne({ email: req.user.email });
        if (userDoc?.status === "fraud") {
          return res.status(403).send({ message: "Your account is restricted. You cannot place orders." });
        }

        const { foodId, mealName, price, quantity, chefId, chefName, userAddress } = req.body;

        const newOrder = {
          foodId,
          mealName,
          price,
          quantity,
          chefId,
          chefName,
          paymentStatus: "Pending",
          userEmail: req.user.email,
          userAddress,
          orderStatus: "pending",
          orderTime: new Date().toISOString(),
        };

        await ordersCollection.insertOne(newOrder);
        res.status(201).send({ success: true, order: newOrder });
      } catch (err) {
        res.status(500).send({ message: "Failed to place order" });
      }
    });

    // Add a review for a meal
    app.post("/reviews/:mealId", verifyJWT, async (req, res) => {
      try {
        const { reviewerName, reviewerImage, rating, comment, mealName } = req.body;

        const newReview = {
          foodId: req.params.mealId,
          mealName,
          reviewerName,
          reviewerImage,
          reviewerEmail: req.user.email,
          rating,
          comment,
          date: new Date().toISOString(),
        };

        await reviewsCollection.insertOne(newReview);
        res.status(201).send({ success: true, review: newReview });
      } catch (err) {
        res.status(500).send({ message: "Failed to submit review" });
      }
    });

    // Update a review
    app.put("/reviews/:id", verifyJWT, async (req, res) => {
      try {
        const { rating, comment } = req.body;

        await reviewsCollection.updateOne(
          { _id: new ObjectId(req.params.id), reviewerEmail: req.user.email },
          { $set: { rating, comment, date: new Date().toISOString() } }
        );

        res.send({ success: true, message: "Review updated successfully" });
      } catch (err) {
        res.status(500).send({ message: "Failed to update review" });
      }
    });

    // Delete a review
    app.delete("/reviews/:id", verifyJWT, async (req, res) => {
      try {
        await reviewsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
          reviewerEmail: req.user.email,
        });
        res.send({ success: true, message: "Review deleted successfully" });
      } catch (err) {
        res.status(500).send({ message: "Failed to delete review" });
      }
    });

    // Add meal to favorites
    app.post("/favorites/:mealId", verifyJWT, async (req, res) => {
      try {
        const userEmail = req.user.email;
        const mealId    = req.params.mealId;

        const meal = await mealsCollection.findOne({ _id: new ObjectId(mealId) });
        if (!meal) return res.status(404).send({ message: "Meal not found" });

        const existing = await favoritesCollection.findOne({ userEmail, mealId });
        if (existing) {
          return res.send({ success: false, message: "Already in favorites" });
        }

        const favorite = {
          userEmail,
          mealId,
          mealName: meal.foodName,
          chefId:   meal.chefId,
          chefName: meal.chefName,
          price:    meal.price,
          addedTime: new Date().toISOString(),
        };

        await favoritesCollection.insertOne(favorite);
        res.status(201).send({ success: true, favorite });
      } catch (err) {
        res.status(500).send({ message: "Failed to add to favorites" });
      }
    });

    // Delete a favorite meal
    app.delete("/favorites/:id", verifyJWT, async (req, res) => {
      try {
        await favoritesCollection.deleteOne({
          _id: new ObjectId(req.params.id),
          userEmail: req.user.email,
        });
        res.send({ success: true, message: "Removed from favorites" });
      } catch (err) {
        res.status(500).send({ message: "Failed to remove favorite" });
      }
    });
    // Request to become Chef or Admin
    app.post("/requests", verifyJWT, async (req, res) => {
      try {
        const { requestType } = req.body;
        const user = await usersCollection.findOne({ email: req.user.email });

        // Prevent duplicate pending requests
        const existing = await requestsCollection.findOne({
          userEmail: user.email,
          requestType,
          requestStatus: "pending",
        });
        if (existing) {
          return res.send({ success: false, message: "You already have a pending request" });
        }

        const newRequest = {
          userName:      user.name,
          userEmail:     user.email,
          requestType,
          requestStatus: "pending",
          requestTime:   new Date().toISOString(),
        };

        await requestsCollection.insertOne(newRequest);
        res.status(201).send({ success: true, request: newRequest });
      } catch (err) {
        res.status(500).send({ message: "Failed to send request" });
      }
    });

    // Save payment and update order payment status
    app.post("/payments", verifyJWT, async (req, res) => {
      try {
        const { orderId, paymentIntentId, amount } = req.body;
        const payment = {
          orderId,
          userEmail: req.user.email,
          paymentIntentId,
          amount,
          status: "success",
          time: new Date().toISOString(),
        };

        await paymentsCollection.insertOne(payment);
        await ordersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { paymentStatus: "paid" } }
        );

        res.send({ success: true, payment });
      } catch (err) {
        res.status(500).send({ message: "Payment failed" });
      }
    });

    // =========================================
    // CHEF DASHBOARD ROUTES (role: "chef")
    // =========================================
    // Get chef profile
    app.get("/chef/profile", verifyJWT, authorizeRoles("chef"), async (req, res) => {
      try {
        const chef = await usersCollection.findOne({ email: req.user.email });
        res.send({ success: true, user: chef });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch chef profile" });
      }
    });
    // Create a new meal
    app.post("/meals", verifyJWT, authorizeRoles("chef"), async (req, res) => {
      try {
        const chefDoc = await usersCollection.findOne({ email: req.user.email });
        if (chefDoc?.status === "fraud") {
          return res.status(403).send({ message: "Your account is restricted. You cannot create meals." });
        }

        const meal = { ...req.body, createdAt: new Date().toISOString() };
        await mealsCollection.insertOne(meal);
        res.status(201).send({ success: true, meal });
      } catch (err) {
        res.status(500).send({ message: "Failed to create meal" });
      }
    });

    // Get chef's own meals
    app.get("/chef/meals", verifyJWT, authorizeRoles("chef"), async (req, res) => {
      try {
        const chef  = await usersCollection.findOne({ email: req.user.email });
        const meals = await mealsCollection.find({ chefId: chef.chefId }).toArray();
        res.send({ success: true, meals });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch chef meals" });
      }
    });

    // Update a meal
    app.put("/meals/:id", verifyJWT, authorizeRoles("chef"), async (req, res) => {
      try {
        const chef = await usersCollection.findOne({ email: req.user.email });
        await mealsCollection.updateOne(
          { _id: new ObjectId(req.params.id), chefId: chef.chefId },
          { $set: req.body }
        );
        res.send({ success: true, message: "Meal updated successfully" });
      } catch (err) {
        res.status(500).send({ message: "Failed to update meal" });
      }
    });

    // Delete a meal
    app.delete("/meals/:id", verifyJWT, authorizeRoles("chef"), async (req, res) => {
      try {
        const chef = await usersCollection.findOne({ email: req.user.email });
        await mealsCollection.deleteOne({
          _id: new ObjectId(req.params.id),
          chefId: chef.chefId,
        });
        res.send({ success: true, message: "Meal deleted successfully" });
      } catch (err) {
        res.status(500).send({ message: "Failed to delete meal" });
      }
    });

    // Get all orders for this chef
    app.get("/chef/orders", verifyJWT, authorizeRoles("chef"), async (req, res) => {
      try {
        const chef   = await usersCollection.findOne({ email: req.user.email });
        const orders = await ordersCollection.find({ chefId: chef.chefId }).toArray();
        res.send({ success: true, orders });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch chef orders" });
      }
    });

    // Update order status
    app.put("/orders/:id/status", verifyJWT, authorizeRoles("chef"), async (req, res) => {
      try {
        const { status } = req.body; // "accepted" | "cancelled" | "delivered"
        const chef = await usersCollection.findOne({ email: req.user.email });

        await ordersCollection.updateOne(
          { _id: new ObjectId(req.params.id), chefId: chef.chefId },
          { $set: { orderStatus: status } }
        );
        res.send({ success: true, status });
      } catch (err) {
        res.status(500).send({ message: "Failed to update order status" });
      }
    });

    // ADMIN DASHBOARD ROUTES (role: "admin") 

    // Get admin profile
    app.get("/admin/profile", verifyJWT, authorizeRoles("admin"), async (req, res) => {
      try {
        const admin = await usersCollection.findOne({ email: req.user.email });
        res.send({ success: true, user: admin });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch admin profile" });
      }
    });
    // Get all users
    app.get("/admin/users", verifyJWT, authorizeRoles("admin"), async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.send({ success: true, users });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch users" });
      }
    });

    // Mark user as fraud
    app.put("/admin/users/:id/fraud", verifyJWT, authorizeRoles("admin"), async (req, res) => {
      try {
        await usersCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status: "fraud" } }
        );
        res.send({ success: true, message: "User marked as fraud" });
      } catch (err) {
        res.status(500).send({ message: "Failed to mark user as fraud" });
      }
    });

    // Get all role upgrade requests
    app.get("/admin/requests", verifyJWT, authorizeRoles("admin"), async (req, res) => {
      try {
        const requests = await requestsCollection.find().toArray();
        res.send({ success: true, requests });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch requests" });
      }
    });


   app.get("/meals", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 12, 1);

    const search = req.query.search || "";
    const sort = req.query.sort || "";
    const deliveryArea = req.query.deliveryArea || "";

    // ⭐ NEW: rating filter (e.g. ?minRating=4)
    const minRating = parseFloat(req.query.minRating) || 0;

    const query = {};

    // 🔍 search by food name
    if (search.trim()) {
      query.foodName = { $regex: search.trim(), $options: "i" };
    }

    // 📍 delivery area filter
    if (deliveryArea.trim()) {
      query.deliveryArea = { $regex: deliveryArea.trim(), $options: "i" };
    }

    // ⭐ rating filter (greater than or equal)
    if (minRating > 0) {
      query.rating = { $gte: minRating };
    }

    // 📊 sorting options
    let sortOption = {};

    switch (sort) {
      case "asc":
        sortOption = { price: 1 };
        break;

      case "desc":
        sortOption = { price: -1 };
        break;

      case "latest":
        sortOption = { createdAt: -1 };
        break;

      // ⭐ NEW: sort by rating
      case "rating":
        sortOption = { rating: -1 };
        break;

      default:
        sortOption = { createdAt: -1 };
    }

    const totalMeals = await mealsCollection.countDocuments(query);

    const meals = await mealsCollection
      .find(query)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    res.status(200).send({
      success: true,
      meals,
      totalMeals,
      page,
      limit,
    });

  } catch (err) {
    console.error(err);
    res.status(500).send({
      success: false,
      message: "Failed to fetch meals",
    });
  }
});


    // Accept or Reject a role request
    app.put("/admin/requests/:id", verifyJWT, authorizeRoles("admin"), async (req, res) => {
      try {
        const { action } = req.body; // "accept" or "reject"

        const request = await requestsCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!request) return res.status(404).send({ message: "Request not found" });

        if (action === "accept") {
          if (request.requestType === "chef") {
            const chefId = "chef-" + Math.floor(1000 + Math.random() * 9000);
            await usersCollection.updateOne(
              { email: request.userEmail },
              { $set: { role: "chef", chefId } }
            );
          } else if (request.requestType === "admin") {
            await usersCollection.updateOne(
              { email: request.userEmail },
              { $set: { role: "admin" } }
            );
          }

          await requestsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { requestStatus: "approved" } }
          );

          return res.send({ success: true, status: "approved" });
        }

        if (action === "reject") {
          await requestsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { requestStatus: "rejected" } }
          );
          return res.send({ success: true, status: "rejected" });
        }

        res.status(400).send({ message: "Invalid action. Use 'accept' or 'reject'" });
      } catch (err) {
        res.status(500).send({ message: "Failed to update request" });
      }
    });

    // Platform statistics
    app.get("/admin/statistics", verifyJWT, authorizeRoles("admin"), async (req, res) => {
      try {
        const totalUsers      = await usersCollection.countDocuments();
        const ordersPending   = await ordersCollection.countDocuments({ orderStatus: "pending" });
        const ordersDelivered = await ordersCollection.countDocuments({ orderStatus: "delivered" });

        const payments = await paymentsCollection.find().toArray();
        const totalPaymentAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

        res.send({
          success: true,
          totalUsers,
          ordersPending,
          ordersDelivered,
          totalPaymentAmount,
        });
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch statistics" });
      }
    });

  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});