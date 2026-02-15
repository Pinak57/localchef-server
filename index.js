const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const Stripe = require("stripe");
const bcrypt = require("bcrypt");

const app = express();
const port = process.env.PORT || 5000;

// ✅ Stripe setup
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Middleware
app.use(cors({
  origin: ["http://localhost:5173"], // তোমার frontend origin
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// ---------------- JWT Middleware ----------------
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token; // ✅ শুধু cookie থেকে নিলাম
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid token" });
  }
};

const verifyRole = (role) => {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      return res.status(403).json({ message: "Forbidden: Insufficient role" });
    }
    next();
  };
};

// ✅ MongoDB connection
const client = new MongoClient(process.env.MONGO_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
  try {
    // await client.connect();
    console.log("✅ MongoDB Connected");

    const db = client.db("LocalChefBazaar");
    const usersCollection = db.collection("users");
    const mealsCollection = db.collection("meals");
    const ordersCollection = db.collection("orders");
    const reviewsCollection = db.collection("reviews");
    const favoritesCollection = db.collection("favorites");
    const requestsCollection = db.collection("requests");
    const paymentsCollection = db.collection("payments");

    // ✅ Root route
    app.get("/", (req, res) => {
      res.send("🚀 LocalChef Server Running...");
    });

    // ---------------- Admin Endpoints ----------------

// ✅ Get all users (Admin only)
app.get("/admin/users", verifyToken, verifyRole("admin"), async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.json(users);
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// ✅ Get all orders (Admin only)
app.get("/admin/orders", verifyToken, verifyRole("admin"), async (req, res) => {
  try {
    const orders = await ordersCollection.find().toArray();
    res.json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

// ✅ Get platform statistics (Admin only)
app.get("/admin/stats", verifyToken, verifyRole("admin"), async (req, res) => {
  try {
    const totalUsers = await usersCollection.countDocuments();
    const totalMeals = await mealsCollection.countDocuments();
    const totalOrders = await ordersCollection.countDocuments();

    // ✅ Revenue calculation (sum of paid orders)
    const paidOrders = await ordersCollection.find({ paymentStatus: "paid" }).toArray();
    const revenue = paidOrders.reduce((sum, order) => sum + (order.price || 0), 0);

    res.json({ totalUsers, totalMeals, totalOrders, revenue });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ message: "Failed to fetch stats" });
  }
});



// ---------------- Chef Endpoints ----------------

// ✅ Get all meals of logged-in chef
app.get("/chef/meals", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const meals = await mealsCollection.find({ chefId: req.user.id }).toArray();
    res.json(meals);
  } catch (err) {
    console.error("Error fetching meals:", err);
    res.status(500).json({ message: "Failed to fetch meals" });
  }
});

// ✅ Add new meal
app.post("/chef/meals", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const newMeal = { ...req.body, chefId: req.user.id };
    const result = await mealsCollection.insertOne(newMeal);
    res.json(result);
  } catch (err) {
    console.error("Error adding meal:", err);
    res.status(500).json({ message: "Failed to add meal" });
  }
});

// ✅ Update meal
app.put("/chef/meals/:id", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const id = req.params.id;
    const updateDoc = { $set: req.body };
    const result = await mealsCollection.updateOne(
      { _id: new ObjectId(id), chefId: req.user.id },
      updateDoc
    );
    res.json(result);
  } catch (err) {
    console.error("Error updating meal:", err);
    res.status(500).json({ message: "Failed to update meal" });
  }
});

// ✅ Delete meal
app.delete("/chef/meals/:id", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const id = req.params.id;
    const result = await mealsCollection.deleteOne({
      _id: new ObjectId(id),
      chefId: req.user.id,
    });
    res.json(result);
  } catch (err) {
    console.error("Error deleting meal:", err);
    res.status(500).json({ message: "Failed to delete meal" });
  }
});

// ✅ Get order requests for chef's meals
app.get("/chef/orders", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const orders = await ordersCollection.find({ chefId: req.user.id }).toArray();
    res.json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

// ✅ Accept order
app.put("/chef/orders/:id/accept", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const id = req.params.id;
    const result = await ordersCollection.updateOne(
      { _id: new ObjectId(id), chefId: req.user.id },
      { $set: { orderStatus: "accepted" } }
    );
    res.json(result);
  } catch (err) {
    console.error("Error accepting order:", err);
    res.status(500).json({ message: "Failed to accept order" });
  }
});

// ✅ Reject order
app.put("/chef/orders/:id/reject", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const id = req.params.id;
    const result = await ordersCollection.updateOne(
      { _id: new ObjectId(id), chefId: req.user.id },
      { $set: { orderStatus: "rejected" } }
    );
    res.json(result);
  } catch (err) {
    console.error("Error rejecting order:", err);
    res.status(500).json({ message: "Failed to reject order" });
  }
});



// ---------------- User Endpoints ----------------

// ✅ Get user dashboard (orders + favorites একসাথে)
app.get("/user/dashboard", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;

    const orders = await ordersCollection.find({ userEmail }).toArray();
    const favorites = await favoritesCollection.find({ userEmail }).toArray();

    res.json({ orders, favorites });
  } catch (err) {
    console.error("Error fetching user dashboard:", err);
    res.status(500).json({ message: "Failed to fetch dashboard data" });
  }
});

// ✅ Place new order
app.post("/user/orders", verifyToken, async (req, res) => {
  try {
    const orderData = {
      ...req.body,
      userEmail: req.user.email,
      orderStatus: "pending",
      paymentStatus: "unpaid",
      orderTime: new Date(),
    };
    const result = await ordersCollection.insertOne(orderData);
    res.json(result);
  } catch (err) {
    console.error("Error placing order:", err);
    res.status(500).json({ message: "Failed to place order" });
  }
});

// ✅ Get all orders of logged-in user
app.get("/user/orders", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const orders = await ordersCollection.find({ userEmail }).toArray();
    res.json(orders);
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

// ✅ Add meal to favorites
app.post("/user/favorites", verifyToken, async (req, res) => {
  try {
    const favoriteData = {
      ...req.body,
      userEmail: req.user.email,
    };
    const result = await favoritesCollection.insertOne(favoriteData);
    res.json(result);
  } catch (err) {
    console.error("Error adding favorite:", err);
    res.status(500).json({ message: "Failed to add favorite" });
  }
});

// ✅ Get all favorites of logged-in user
app.get("/user/favorites", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const favorites = await favoritesCollection.find({ userEmail }).toArray();
    res.json(favorites);
  } catch (err) {
    console.error("Error fetching favorites:", err);
    res.status(500).json({ message: "Failed to fetch favorites" });
  }
});



    // 👉 এখান থেকে আমরা auth, users, requests, orders, stats routes লিখব step by step

  // ---------------- AUTH ----------------

// ✅ Register new user (Firebase handles password)
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, address, avatar, role, status } = req.body;

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const newUser = {
      name,
      email,
      address,
      avatar,
      role: role || "user",
      status: status || "active",
    };

    await usersCollection.insertOne(newUser);

    // ✅ Create JWT token
    const token = jwt.sign(
      { email: newUser.email, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // ✅ Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    });

    res.json({
      success: true,
      user: newUser,
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({ success: false, message: "Registration failed" });
  }
});



// ✅ Login user (Firebase handles authentication, backend just fetches profile)
app.post("/auth/login", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // ✅ Create JWT token with role + email
    const token = jwt.sign(
      { email: user.email, role: user.role, id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // ✅ Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: false, // dev mode, production এ true করো
      sameSite: "lax",
    });

    res.json({
      success: true,
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        avatar: user.avatar || null,
        address: user.address || null,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

// ✅ Get current user
app.get("/auth/me", verifyToken, async (req, res) => {
  try {
    const user = await usersCollection.findOne({ email: req.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      user: {
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar || null,
        address: user.address || null,
        status: user.status,
      },
    });
  } catch (err) {
    console.error("Auth check error:", err);
    res.status(500).json({ message: "Failed to fetch user" });
  }
});

// ✅ Logout
app.post("/auth/logout", (req, res) => {
  res.clearCookie("token").json({ message: "Logged out" });
});

// ---------------- USER DASHBOARD ----------------
app.get("/user/dashboard", verifyToken, async (req, res) => {
  try {
    const orders = await ordersCollection.find({ email: req.user.email }).toArray();
    const favorites = await favoritesCollection.find({ email: req.user.email }).toArray();

    res.json({ orders, favorites });
  } catch (err) {
    console.error("User dashboard error:", err);
    res.status(500).json({ message: "Failed to load user dashboard" });
  }
});

// ---------------- CHEF DASHBOARD ----------------
app.get("/chef/dashboard", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const meals = await mealsCollection.find({ chefEmail: req.user.email }).toArray();
    const requests = await requestsCollection.find({ chefEmail: req.user.email }).toArray();

    res.json({ meals, requests });
  } catch (err) {
    console.error("Chef dashboard error:", err);
    res.status(500).json({ message: "Failed to load chef dashboard" });
  }
});

// ---------------- ADMIN DASHBOARD ----------------
app.get("/admin/dashboard", verifyToken, verifyRole("admin"), async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    const requests = await requestsCollection.find().toArray();
    const stats = {
      totalUsers: await usersCollection.countDocuments(),
      totalMeals: await mealsCollection.countDocuments(),
      totalOrders: await ordersCollection.countDocuments(),
    };

    res.json({ users, requests, stats });
  } catch (err) {
    console.error("Admin dashboard error:", err);
    res.status(500).json({ message: "Failed to load admin dashboard" });
  }
});



// ---------------- MEALS ----------------

// ✅ Get meals (supports pagination + dynamic limit)
app.get("/meals", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const totalMeals = await mealsCollection.countDocuments();
    const meals = await mealsCollection.find()
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({
      meals,
      totalMeals,
      totalPages: Math.ceil(totalMeals / limit),
      currentPage: page,
    });
  } catch (err) {
    console.error("Error fetching meals:", err);
    res.status(500).json({ message: "Failed to fetch meals" });
  }
});

// ✅ Get single meal by ID
app.get("/meals/:id", async (req, res) => {
  try {
    const meal = await mealsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!meal) return res.status(404).json({ message: "Meal not found" });
    res.json(meal);
  } catch (err) {
    console.error("Error fetching meal:", err);
    res.status(500).json({ message: "Failed to fetch meal" });
  }
});

// ✅ Add new meal (only chef)
app.post("/meals", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const meal = {
      ...req.body,
      chefEmail: req.user.email, // ✅ track chef
      createdAt: new Date(),
    };
    const result = await mealsCollection.insertOne(meal);
    res.json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error("Error adding meal:", err);
    res.status(500).json({ message: "Failed to add meal" });
  }
});

// ✅ Update meal (only chef, must own meal)
app.put("/meals/:id", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const meal = await mealsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!meal) return res.status(404).json({ message: "Meal not found" });

    if (meal.chefEmail !== req.user.email) {
      return res.status(403).json({ message: "Forbidden: You can only update your own meals" });
    }

    const updated = await mealsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: req.body }
    );
    res.json({ success: true, modifiedCount: updated.modifiedCount });
  } catch (err) {
    console.error("Error updating meal:", err);
    res.status(500).json({ message: "Failed to update meal" });
  }
});

// ✅ Delete meal (only chef, must own meal)
app.delete("/meals/:id", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const meal = await mealsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!meal) return res.status(404).json({ message: "Meal not found" });

    if (meal.chefEmail !== req.user.email) {
      return res.status(403).json({ message: "Forbidden: You can only delete your own meals" });
    }

    const deleted = await mealsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true, deletedCount: deleted.deletedCount });
  } catch (err) {
    console.error("Error deleting meal:", err);
    res.status(500).json({ message: "Failed to delete meal" });
  }
});

 // ---------------- ORDERS ----------------

// ✅ Place new order (user only)
app.post("/orders", verifyToken, verifyRole("user"), async (req, res) => {
  try {
    const { mealId, mealName, foodName, chefId, chefName, price } = req.body;
    const finalMealName = mealName || foodName; // ✅ normalize

    if (!mealId || !finalMealName || !chefId || !chefName || !price) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const order = {
      mealId,
      mealName: finalMealName, // ✅ always save as mealName
      chefId,
      chefName,
      price,
      userEmail: req.user.email,
      orderStatus: "pending",
      paymentStatus: "Pending",
      orderTime: new Date().toISOString(),
    };

    const result = await ordersCollection.insertOne(order);
    res.json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error("Error placing order:", err);
    res.status(500).json({ message: "Failed to place order" });
  }
});


// ✅ Get my orders (user only)
app.get("/orders/my-orders", verifyToken, verifyRole("user"), async (req, res) => {
  try {
    const orders = await ordersCollection.find({ userEmail: req.user.email }).toArray();
    res.json({ success: true, orders });
  } catch (err) {
    console.error("Error fetching orders:", err);
    res.status(500).json({ message: "Failed to fetch orders" });
  }
});

// ✅ Cancel order (user only, must own order)
app.put("/orders/:id/cancel", verifyToken, verifyRole("user"), async (req, res) => {
  try {
    const updated = await ordersCollection.updateOne(
      { _id: new ObjectId(req.params.id), userEmail: req.user.email },
      { $set: { orderStatus: "cancelled", cancelledAt: new Date().toISOString() } }
    );
    res.json({ success: true, modifiedCount: updated.modifiedCount });
  } catch (err) {
    console.error("Error cancelling order:", err);
    res.status(500).json({ message: "Failed to cancel order" });
  }
});

// ✅ Chef requests (orders received by chef)
app.get("/orders/requests", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const requests = await ordersCollection.find({ chefId: req.user.chefId }).toArray();
    res.json({ success: true, requests });
  } catch (err) {
    console.error("Error fetching chef requests:", err);
    res.status(500).json({ message: "Failed to fetch requests" });
  }
});

// ✅ Accept order (chef only, must own order)
app.put("/orders/:id/accept", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const updated = await ordersCollection.updateOne(
      { _id: new ObjectId(req.params.id), chefId: req.user.chefId },
      { $set: { orderStatus: "accepted", acceptedAt: new Date().toISOString() } }
    );
    res.json({ success: true, modifiedCount: updated.modifiedCount });
  } catch (err) {
    console.error("Error accepting order:", err);
    res.status(500).json({ message: "Failed to accept order" });
  }
});

// ✅ Reject order (chef only, must own order)
app.put("/orders/:id/reject", verifyToken, verifyRole("chef"), async (req, res) => {
  try {
    const updated = await ordersCollection.updateOne(
      { _id: new ObjectId(req.params.id), chefId: req.user.chefId },
      { $set: { orderStatus: "rejected", rejectedAt: new Date().toISOString() } }
    );
    res.json({ success: true, modifiedCount: updated.modifiedCount });
  } catch (err) {
    console.error("Error rejecting order:", err);
    res.status(500).json({ message: "Failed to reject order" });
  }
});


// ---------------- REVIEWS ----------------

// ✅ Get all reviews (latest for homepage)
app.get("/reviews", async (req, res) => {
  try {
    const reviews = await reviewsCollection
      .find()                // সব reviews আনবে
      .sort({ date: -1 })    // latest first
      .toArray();

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
        : 0;

    res.json({
      success: true,
      reviews,
      totalReviews,
      averageRating,
    });
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res.status(500).json({ message: "Failed to fetch reviews" });
  }
});


// ✅ Add a new review (only logged-in users)
app.post("/reviews", verifyToken, async (req, res) => {
  try {
    const { foodId, rating, comment } = req.body;

    if (!foodId || !rating || !comment) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }

    const newReview = {
      foodId,
      reviewerName: req.user.name || "Anonymous", // ✅ auto from JWT
      reviewerEmail: req.user.email,
      reviewerImage: req.user.avatar || null,
      rating,
      comment,
      date: new Date().toISOString(),
    };

    const result = await reviewsCollection.insertOne(newReview);

    res.json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error("Error submitting review:", err);
    res.status(500).json({ message: "Failed to submit review" });
  }
});



   // ---------------- FAVORITES ----------------

// ✅ Add to Favorites
// ✅ Add to Favorites
app.post("/favorites", verifyToken, async (req, res) => {
  try {
    const { mealId, mealName, foodName, chefId, chefName, price, foodImage } = req.body;
    const userEmail = req.user.email;

    // allow either mealName or foodName
    const finalMealName = mealName || foodName;

    if (!mealId || !finalMealName || !chefId || !chefName || !price || !foodImage) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const existing = await favoritesCollection.findOne({ mealId, userEmail });
    if (existing) {
      return res.status(400).json({ message: "Meal already in favorites" });
    }

    const newFavorite = {
      userEmail,
      mealId,
      mealName: finalMealName, // ✅ normalize
      chefId,
      chefName,
      price,
      foodImage,
      addedTime: new Date().toISOString(),
    };

    const result = await favoritesCollection.insertOne(newFavorite);
    res.json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error("Error adding favorite:", err);
    res.status(500).json({ message: "Failed to add favorite" });
  }
});



// ✅ Get user favorites
app.get("/favorites", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const favorites = await favoritesCollection.find({ userEmail }).toArray();
    res.json({
      success: true,
      favorites,
      totalFavorites: favorites.length,
    });
  } catch (err) {
    console.error("Error fetching favorites:", err);
    res.status(500).json({ message: "Failed to fetch favorites" });
  }
});

// ✅ Remove from Favorites
app.delete("/favorites/:mealId", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const mealId = req.params.mealId;

    const deleted = await favoritesCollection.deleteOne({ mealId, userEmail });
    if (deleted.deletedCount === 0) {
      return res.status(404).json({ message: "Favorite not found" });
    }

    res.json({ success: true, deletedCount: deleted.deletedCount });
  } catch (err) {
    console.error("Error removing favorite:", err);
    res.status(500).json({ message: "Failed to remove favorite" });
  }
});

// ---------------- REQUESTS ----------------

// ✅ Create new request (user only)
app.post("/requests", verifyToken, verifyRole("user"), async (req, res) => {
  try {
    const request = {
      ...req.body,
      userEmail: req.user.email, // ✅ auto from JWT
      requestStatus: "pending",
      requestTime: new Date().toISOString(),
    };
    const result = await requestsCollection.insertOne(request);
    res.json({ success: true, insertedId: result.insertedId });
  } catch (err) {
    console.error("Error creating request:", err);
    res.status(500).json({ message: "Failed to create request" });
  }
});

// ✅ Get all requests (admin only)
app.get("/requests", verifyToken, verifyRole("admin"), async (req, res) => {
  try {
    const requests = await requestsCollection.find().toArray();
    res.json({
      success: true,
      requests,
      totalRequests: requests.length,
    });
  } catch (err) {
    console.error("Error fetching requests:", err);
    res.status(500).json({ message: "Failed to fetch requests" });
  }
});

// ✅ Approve request (admin only)
app.put("/requests/:id/approve", verifyToken, verifyRole("admin"), async (req, res) => {
  try {
    const request = await requestsCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!request) return res.status(404).json({ message: "Request not found" });

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
      { $set: { requestStatus: "approved", approvedAt: new Date().toISOString() } }
    );

    res.json({ success: true, message: "Request approved successfully" });
  } catch (err) {
    console.error("Error approving request:", err);
    res.status(500).json({ message: "Failed to approve request" });
  }
});

// ✅ Reject request (admin only)
app.put("/requests/:id/reject", verifyToken, verifyRole("admin"), async (req, res) => {
  try {
    const updated = await requestsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { requestStatus: "rejected", rejectedAt: new Date().toISOString() } }
    );
    res.json({ success: true, message: "Request rejected", modifiedCount: updated.modifiedCount });
  } catch (err) {
    console.error("Error rejecting request:", err);
    res.status(500).json({ message: "Failed to reject request" });
  }
});

    // ---------------- PAYMENTS (Stripe) ----------------
 // ---------------- PAYMENTS (Stripe) ----------------

// ✅ Create Stripe Checkout Session
app.post("/payments/create-payment", verifyToken, async (req, res) => {
  try {
    const { amount, currency, orderId } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: currency || "usd",
            product_data: { name: "LocalChef Order" },
            unit_amount: amount * 100, // cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "http://localhost:5173/payment-success",
      cancel_url: "http://localhost:5173/payment-failure",
      metadata: { orderId }, // ✅ attach orderId
    });

    const paymentRecord = {
      orderId,
      email: req.user.email,
      amount,
      currency: currency || "usd",
      status: "pending",
      sessionId: session.id,
      createdAt: new Date().toISOString(),
    };
    await paymentsCollection.insertOne(paymentRecord);

    res.json({ success: true, id: session.id, url: session.url });
  } catch (err) {
    console.error("Payment creation error:", err);
    res.status(500).json({ message: "Payment creation failed" });
  }
});

// ✅ Stripe Webhook
app.post("/payments/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // ✅ Update payment record
    await paymentsCollection.updateOne(
      { sessionId: session.id },
      { $set: { status: "paid", paidAt: new Date().toISOString() } }
    );

    // ✅ Update order payment status
    if (session.metadata?.orderId) {
      await ordersCollection.updateOne(
        { _id: new ObjectId(session.metadata.orderId) },
        { $set: { paymentStatus: "paid", orderStatus: "accepted" } }
      );
    }

    console.log("✅ Payment successful:", session.id);
  }

  res.json({ received: true });
});




  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);



app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

