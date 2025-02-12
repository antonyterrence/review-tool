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

// --- Persistence: Use a JSON file to store annotations ---
const annotationsFile = path.join(__dirname, 'annotations.json');

function readAnnotations() {
  try {
    if (!fs.existsSync(annotationsFile)) {
      fs.writeFileSync(annotationsFile, '{}', 'utf8');
    }
    const data = fs.readFileSync(annotationsFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading annotations file:", err);
    return {};
  }
}

function writeAnnotations(data) {
  try {
    fs.writeFileSync(annotationsFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error("Error writing annotations file:", err);
  }
}

/**
 * Endpoint: Upload a zipped webhelp.
 */
app.post('/uploadWebhelp', upload.single('webhelpZip'), (req, res) => {
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
  const annotations = readAnnotations();
  if (!annotations[webhelpId]) annotations[webhelpId] = {};
  if (!annotations[webhelpId][version]) annotations[webhelpId][version] = {};
  // Save the annotation under the provided topic string.
  if (!annotations[webhelpId][version][topic]) annotations[webhelpId][version][topic] = [];
  annotations[webhelpId][version][topic].push(change);
  writeAnnotations(annotations);
  res.json({ status: 'ok' });
});

/**
 * Endpoint: Retrieve review changes for a topic.
 * The topic is captured as a wildcard and decoded.
 */
app.get('/getReviewChanges/:webhelpId/:version/*', (req, res) => {
  const { webhelpId, version } = req.params;
  const topic = decodeURIComponent(req.params[0]);
  const annotations = readAnnotations();
  const changes = (annotations[webhelpId] &&
                   annotations[webhelpId][version] &&
                   annotations[webhelpId][version][topic]) || [];
  res.json(changes);
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
