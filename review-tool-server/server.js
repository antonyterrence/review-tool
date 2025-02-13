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
 * For new documents, no "docId" field is sent.
 * For new version uploads, a "docId" field is provided.
 */
app.post('/uploadWebhelp', upload.single('webhelpZip'), (req, res) => {
  // Check if this is an update (new version) for an existing document.
  if (req.body.docId) {
    const webhelpId = req.body.docId;
    const docDir = path.join(__dirname, 'webhelps', webhelpId);
    let newVersionNumber = 1;
    if (fs.existsSync(docDir)) {
      // Get all version directories (expected to be named "v1", "v2", etc.)
      const versionDirs = fs.readdirSync(docDir, { withFileTypes: true })
                           .filter(item => item.isDirectory())
                           .map(item => item.name);
      const versionNumbers = versionDirs.map(dir => parseInt(dir.replace('v', ''))).filter(n => !isNaN(n));
      if (versionNumbers.length > 0) {
        newVersionNumber = Math.max(...versionNumbers) + 1;
      }
    } else {
      fs.mkdirSync(docDir, { recursive: true });
    }
    const version = "v" + newVersionNumber;
    const targetDir = path.join(docDir, version);
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
  } else {
    // New document upload.
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
  }
});

/**
 * Endpoint: Serve a topic file.
 */
app.get('/webhelp/:webhelpId/:version/*', (req, res) => {
  const { webhelpId, version } = req.params;
  const topicPath = req.params[0];
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
