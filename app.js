const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { Parser } = require('json2csv');
const fs = require('fs').promises;
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 1001;

// Use environment variables for sensitive information
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Connect to MongoDB using the provided connection string or a default local URL
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://cbpsmstest:Cambopay2023@cluster0.9yz8ir7.mongodb.net/API_SMS_GEN?retryWrites=true&w=majority', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});


// Define MongoDB schemas and models
const apiKeySchema = new mongoose.Schema({
  name: String,
  key: String,
});

const ApiKey = mongoose.model('ApiKey', apiKeySchema);

const userSchema = new mongoose.Schema({
  username: String,
  password: String,
});

const User = mongoose.model('User', userSchema);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Parse URL-encoded request bodies and use session for user authentication
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: sessionSecret, resave: true, saveUninitialized: true }));

// Middleware to check user authentication
const authenticate = (req, res, next) => {
  if (req.session.authenticated) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Set the view engine to EJS
app.set('view engine', 'ejs');

// New route for logout all
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Existing routes
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/welcome', authenticate, (req, res) => {
  res.render('welcome', { username: req.session.username });
});

app.get('/generate-key', authenticate, (req, res) => {
  res.render('generate-key');
});

// New route to handle form submission for generating API keys
app.post('/generate-key', authenticate, async (req, res) => {
  const { name } = req.body;

  try {
    // Generate a new unique API key based on the provided name and a random string
    const apiKey = new ApiKey({
      name,
      key: await generateUniqueRandomKey(name),
    });

    await apiKey.save();

    // Redirect to the API keys view
    res.redirect('/api-keys');
  } catch (error) {
    res.send('Error generating API key');
  }
});

app.get('/api-keys', authenticate, async (req, res) => {
  const apiKeys = await ApiKey.find();
  res.render('api-keys', { apiKeys });
});

// New routes for user management
app.get('/create-user', authenticate, (req, res) => {
  res.render('create-user');
});

app.post('/create-user', authenticate, async (req, res) => {
  const { username, password } = req.body;

  const existingUser = await User.findOne({ username });

  if (existingUser) {
    res.send('Username already exists');
  } else {
    const user = new User({ username, password });
    await user.save();
    res.redirect('/view-users');
  }
});

app.get('/view-users', authenticate, async (req, res) => {
  const users = await User.find();
  res.render('view-users', { users });
});

app.get('/edit-user/:userId', authenticate, async (req, res) => {
  const userId = req.params.userId;

  try {
    const user = await User.findById(userId);

    if (!user) {
      res.send('User not found');
      return;
    }

    res.render('edit-user', { user });
  } catch (error) {
    res.send('Error fetching user');
  }
});

app.post('/edit-user/:userId', authenticate, async (req, res) => {
  const userId = req.params.userId;
  const { username, password } = req.body;

  try {
    const user = await User.findById(userId);

    if (!user) {
      res.send('User not found');
      return;
    }

    user.username = username;
    user.password = password;

    await user.save();

    res.redirect('/view-users');
  } catch (error) {
    res.send('Error updating user');
  }
});

// Corrected routes for editing and deleting API keys
app.get('/edit-api-key/:keyId', authenticate, async (req, res) => {
  const keyId = req.params.keyId;

  try {
    const apiKey = await ApiKey.findById(keyId);

    if (!apiKey) {
      res.send('API Key not found');
      return;
    }

    res.render('edit-key', { apiKey });
  } catch (error) {
    res.send('Error fetching API Key');
  }
});

app.post('/edit-api-key/:keyId', authenticate, async (req, res) => {
  const keyId = req.params.keyId;
  const { name } = req.body;

  try {
    const apiKey = await ApiKey.findById(keyId);

    if (!apiKey) {
      res.send('API Key not found');
      return;
    }

    apiKey.name = name;

    await apiKey.save();

    res.redirect('/api-keys');
  } catch (error) {
    res.send('Error updating API Key');
  }
});

app.get('/delete-api-key/:keyId', authenticate, async (req, res) => {
  const keyId = req.params.keyId;

  try {
    await ApiKey.findByIdAndDelete(keyId);

    res.redirect('/api-keys');
  } catch (error) {
    res.send('Error deleting API Key');
  }
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username, password });

  if (user) {
    req.session.authenticated = true;
    req.session.username = username;
    res.redirect('/welcome');
  } else {
    res.send('Invalid credentials');
  }
});

// New route for searching API keys
app.post('/search-api-keys', authenticate, async (req, res) => {
  const { search } = req.body;

  try {
    const apiKeys = await ApiKey.find({ name: { $regex: new RegExp(search, 'i') } });
    res.render('api-keys', { apiKeys });
  } catch (error) {
    res.send('Error searching API keys');
  }
});

// New route for exporting API keys as CSV
app.get('/export-api-keys', authenticate, async (req, res) => {
  try {
    const apiKeys = await ApiKey.find();
    const fields = ['name', 'key'];
    const opts = { fields };
    const parser = new Parser(opts);
    const csv = parser.parse(apiKeys);

    await fs.writeFile('api-keys.csv', csv);  // Use await for asynchronous file write

    res.attachment('api-keys.csv');
    res.status(200).send(csv);
  } catch (error) {
    console.error('Error exporting API keys:', error);
    res.status(500).send('Error exporting API keys');
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Start the server and listen on the specified port
app.listen(process.env.PORT || 1001, () => {
  console.log(`Server is running on http://localhost:${process.env.PORT || 1001}`);
});

// Function to generate a unique random API key based on the provided name
async function generateUniqueRandomKey(name) {
  let key;

  do {
    key = generateRandomKey(name);
  } while (await ApiKey.findOne({ key }));

  return key;
}

// Updated function to generate a random key based on the provided name
function generateRandomKey(name) {
  const generateRandomPart = () => {
    let randomPart = '';

    // Generate a random 128-bit key
    for (let i = 0; i < 32; i++) {
      const randomHexDigit = Math.floor(Math.random() * 16).toString(16);
      randomPart += randomHexDigit;
    }

    return randomPart;
  };

  const randomPart = generateRandomPart();

  // Combine the name and random 128-bit key
  return randomPart;
}
