const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Serve static files from the review-tool-client folder.
app.use(express.static(path.join(__dirname, '../review-tool-client')));

// Configure multer for file uploads.
const upload = multer({ dest: 'uploads/' });

// --- Persistence: Store annotations in a separate file per document in an "annotations" folder ---
// Ensure the annotations folder exists.
const annotationsDir = path.join(__dirname, 'annotations');
if (!fs.existsSync(annotationsDir)) {
  fs.mkdirSync(annotationsDir);
}

// Helper: Get the annotations file path for a given document (webhelpId)
function getAnnotationsFile(webhelpId) {
  return path.join(annotationsDir, `${webhelpId}.json`);
}

// Helper: Read annotations for a document from its JSON file.
function readAnnotations(webhelpId) {
  const filePath = getAnnotationsFile(webhelpId);
  try {
    if (!fs.existsSync(filePath)) {
      // Create an empty JSON file if it doesn't exist.
      fs.writeFileSync(filePath, '{}', 'utf8');
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading annotations file:", err);
    return {};
  }
}

// Helper: Write annotations for a document to its JSON file.
function writeAnnotations(data, webhelpId) {
  const filePath = getAnnotationsFile(webhelpId);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error("Error writing annotations file:", err);
  }
}

/**
 * Endpoint: Upload a zipped webhelp.
 * Expects a form field "webhelpZip" (multipart/form-data).
 */
app.post('/uploadWebhelp', upload.single('webhelpZip'), (req, res) => {
  // Create a unique webhelp ID and initial version folder.
  const webhelpId = Date.now().toString();
  const version = 'v1';
  const targetDir = path.join(__dirname, 'webhelps', webhelpId, version);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.createReadStream(req.file.path)
    .pipe(unzipper.Extract({ path: targetDir }))
    .on('close', () => {
      const items = fs.readdirSync(targetDir, { withFileTypes: true });
      const subDirs = items.filter(item => item.isDirectory()).map(item => item.name);
      const subFolder = subDirs.length > 0 ? subDirs[0] : "";
      let title = "";
      const indexPath = path.join(targetDir, subFolder, "index.html");
      if (fs.existsSync(indexPath)) {
        const fileContent = fs.readFileSync(indexPath, "utf8");
        const match = fileContent.match(/<title>(.*?)<\/title>/i);
        title = match ? match[1] : "";
      }
      res.json({ webhelpId, version, title, subFolder });
    });
});

/**
 * Endpoint: Serve a topic file.
 */
app.get('/webhelp/:webhelpId/:version/*', (req, res) => {
  const { webhelpId, version } = req.params;
  const topicPath = req.params[0]; // The remaining part of the URL.
  const filePath = path.join(__dirname, 'webhelps', webhelpId, version, topicPath);
  res.sendFile(filePath);
});

/**
 * Endpoint: Save a review change.
 * Expects JSON: { webhelpId, version, topic, change }
 */
app.post('/saveReviewChange', (req, res) => {
  const { webhelpId, version, topic, change } = req.body;
  console.log("Received annotation for:", webhelpId, version, topic, change);
  // Read annotations for this document.
  const annotations = readAnnotations(webhelpId);
  if (!annotations[version]) annotations[version] = {};
  if (!annotations[version][topic]) annotations[version][topic] = [];
  annotations[version][topic].push(change);
  writeAnnotations(annotations, webhelpId);
  res.json({ status: 'ok' });
});

/**
 * Endpoint: Retrieve review changes for a topic.
 * The topic is captured as a wildcard (URL‑encoded).
 */
app.get('/getReviewChanges/:webhelpId/:version/*', (req, res) => {
  const { webhelpId, version } = req.params;
  const topic = decodeURIComponent(req.params[0]);
  const annotations = readAnnotations(webhelpId);
  const changes = (annotations[version] && annotations[version][topic]) || [];
  res.json(changes);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
