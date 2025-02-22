/*********************************************
 * Dashboard Page Script
 *********************************************/
// Assume currentUser and currentRole are stored in localStorage after login.
let currentUser = localStorage.getItem("currentUser") || "writer1";
let currentRole = localStorage.getItem("currentRole") || "writer";
localStorage.setItem("currentUser", currentUser);
localStorage.setItem("currentRole", currentRole);

// Show upload section only for writers.
if (currentRole === "writer") {
  document.getElementById("uploadSection").style.display = "block";
}

// --- Document Records API functions ---
function loadDocuments() {
  return fetch("/getDocuments").then(response => response.json());
}
function saveDocument(doc) {
  return fetch("/saveDocument", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc)
  }).then(response => response.json());
}
function updateDocument(docId, newVersion) {
  return fetch("/updateDocument", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId, newVersion })
  }).then(response => response.json());
}

// --- Render the document list on the dashboard ---
function renderDashboard() {
  loadDocuments().then(allDocs => {
    const docListDiv = document.getElementById("docList");
    docListDiv.innerHTML = "";
    let filteredDocs = [];
    if (currentRole === "writer") {
      filteredDocs = allDocs.filter(doc => doc.uploader === currentUser);
    } else if (currentRole === "reviewer") {
      filteredDocs = allDocs.filter(doc => doc.reviewers.indexOf(currentUser) !== -1);
    }
    if (filteredDocs.length === 0) {
      docListDiv.innerHTML = "<p>No documents available.</p>";
      return;
    }
    filteredDocs.forEach(doc => {
      // Ensure the versions array exists.
      if (!doc.versions || !doc.versions.length) {
        doc.versions = [{
          webhelpId: doc.webhelpId || doc.docId,
          version: doc.version || "v1",
          title: doc.title || "Untitled Document",
          subFolder: doc.subFolder || "",
          status: doc.status || "Under Review"
        }];
      }
      const latest = doc.versions[doc.versions.length - 1];
      const docDiv = document.createElement("div");
      docDiv.className = "docItem";
      const docLink = document.createElement("a");
      docLink.textContent = latest.title || `Document ${latest.webhelpId}`;
      // Clicking the title redirects to the review page using the selected version parameters.
      docLink.href = `review.html?webhelpId=${latest.webhelpId}&version=${latest.version}&subFolder=${encodeURIComponent(latest.subFolder)}`;
      docDiv.appendChild(docLink);
      const details = document.createElement("div");
      details.className = "docDetails";
      details.textContent = `Reviewers: ${doc.reviewers.join(", ")} | Status: ${latest.status}`;
      docDiv.appendChild(details);

      // Version controls are shown for writers; reviewers see the versions dropdown only.
      const versionControls = document.createElement("div");
      versionControls.className = "version-controls";
      const versionSelect = document.createElement("select");
      // Populate dropdown with versions – display sequential numbers (1, 2, 3, …)
      doc.versions.forEach(ver => {
        const opt = document.createElement("option");
        // Use the version string (e.g., "v1", "v2") for value.
        opt.value = ver.version;
        // Display just the number by stripping the 'v'.
        opt.textContent = ver.version.replace("v", "");
        if (ver.version === latest.version) {
          opt.selected = true;
        }
        versionSelect.appendChild(opt);
      });
      versionSelect.addEventListener("change", () => {
        const selectedVersion = doc.versions.find(ver => ver.version === versionSelect.value);
        if (selectedVersion) {
          docLink.href = `review.html?webhelpId=${selectedVersion.webhelpId}&version=${selectedVersion.version}&subFolder=${encodeURIComponent(selectedVersion.subFolder)}`;
          details.textContent = `Reviewers: ${doc.reviewers.join(", ")} | Status: ${selectedVersion.status}`;
        }
      });
      versionControls.appendChild(versionSelect);

      // Show the "Upload New Version" button only for writers.
      if (currentRole === "writer") {
        const uploadBtn = document.createElement("button");
        uploadBtn.textContent = "Upload New Version";
        uploadBtn.addEventListener("click", () => {
          const fileInput = document.getElementById("newVersionFile");
          fileInput.dataset.docId = doc.docId;
          fileInput.dataset.currentVersions = JSON.stringify(doc.versions);
          fileInput.click();
        });
        versionControls.appendChild(uploadBtn);
      }
      
      // Add the "View Metrics" button (for both writers and reviewers)
      // Add the "View Metrics" button (for both writers and reviewers)
const metricsBtn = document.createElement("button");
metricsBtn.textContent = "View Metrics";
metricsBtn.addEventListener("click", () => {
  // Fetch metrics for all versions by passing "all" as the version parameter.
  fetch(`/getReviewMetrics/${doc.docId || latest.webhelpId}/all`)
    .then(response => response.json())
    .then(metrics => {
      // Expecting metrics.perReviewerPerVersion to be an object like:
      // { "Reviewer1": { "v1": {...}, "v2": {...} }, "Reviewer2": { "v1": {...} } }
      const data = metrics.perReviewerPerVersion || {};
      
      // Build a set of all reviewers and versions for filtering.
      const reviewers = Object.keys(data);
      let versionsSet = new Set();
      reviewers.forEach(function(reviewer) {
        Object.keys(data[reviewer]).forEach(function(ver) {
          versionsSet.add(ver);
        });
      });
      const versions = Array.from(versionsSet).sort();

      // Build filtering HTML for Reviewer and Version.
      let filterHTML = '<label for="reviewerFilter">Filter by Reviewer: </label>';
      filterHTML += '<select id="reviewerFilter"><option value="all">All</option>';
      reviewers.forEach(function(reviewer) {
        filterHTML += '<option value="' + reviewer + '">' + reviewer + '</option>';
      });
      filterHTML += '</select><br><br>';
      filterHTML += '<label for="versionFilter">Filter by Version: </label>';
      filterHTML += '<select id="versionFilter"><option value="all">All</option>';
      versions.forEach(function(ver) {
        filterHTML += '<option value="' + ver + '">' + ver + '</option>';
      });
      filterHTML += '</select><br><br>';

      // Build the table with modern styling.
      let tableHTML = '<table id="metricsTable" style="width:100%; border-collapse:collapse;">';
      tableHTML += '<thead style="background:#f2f2f2;"><tr>';
      tableHTML += '<th style="padding:8px; text-align:left;">Reviewer</th>';
      tableHTML += '<th style="padding:8px; text-align:left;">Version</th>';
      tableHTML += '<th style="padding:8px; text-align:right;">Total Comments</th>';
      tableHTML += '<th style="padding:8px; text-align:right;">Accepted</th>';
      tableHTML += '<th style="padding:8px; text-align:right;">Rejected</th>';
      tableHTML += '<th style="padding:8px; text-align:right;">Resolved</th>';
      tableHTML += '<th style="padding:8px; text-align:right;">Open</th>';
      tableHTML += '</tr></thead><tbody>';
      
      // Build rows for each (reviewer, version) pair.
      for (let reviewer in data) {
        for (let ver in data[reviewer]) {
          const row = data[reviewer][ver];
          tableHTML += '<tr data-reviewer="' + reviewer + '" data-version="' + ver + '" style="border-top:1px solid #ddd;">';
          tableHTML += '<td style="padding:8px;">' + reviewer + '</td>';
          tableHTML += '<td style="padding:8px;">' + ver + '</td>';
          tableHTML += '<td style="padding:8px; text-align:right;">' + row.total + '</td>';
          tableHTML += '<td style="padding:8px; text-align:right;">' + row.accepted + '</td>';
          tableHTML += '<td style="padding:8px; text-align:right;">' + row.rejected + '</td>';
          tableHTML += '<td style="padding:8px; text-align:right;">' + row.resolved + '</td>';
          tableHTML += '<td style="padding:8px; text-align:right;">' + row.open + '</td>';
          tableHTML += '</tr>';
        }
      }
      tableHTML += '</tbody></table>';

      // Populate the modal content with the filter controls and table.
      const metricsContent = document.getElementById("metricsContent");
      metricsContent.innerHTML = filterHTML + tableHTML;

      // Filtering function: shows rows that match both selected reviewer and version.
      function applyFilters() {
        const reviewerSelected = document.getElementById("reviewerFilter").value;
        const versionSelected = document.getElementById("versionFilter").value;
        const rows = document.querySelectorAll("#metricsTable tbody tr");
        rows.forEach(function(row) {
          const rowReviewer = row.getAttribute("data-reviewer");
          const rowVersion = row.getAttribute("data-version");
          let show = true;
          if (reviewerSelected !== "all" && rowReviewer !== reviewerSelected) {
            show = false;
          }
          if (versionSelected !== "all" && rowVersion !== versionSelected) {
            show = false;
          }
          row.style.display = show ? "" : "none";
        });
      }

      // Add event listeners to both filters.
      document.getElementById("reviewerFilter").addEventListener("change", applyFilters);
      document.getElementById("versionFilter").addEventListener("change", applyFilters);

      // Display the modal (make sure your HTML contains a modal with id "metricsModal").
      document.getElementById("metricsModal").style.display = "block";
    })
    .catch(function(err) {
      console.error("Error fetching metrics:", err);
    });
});
versionControls.appendChild(metricsBtn);

      // Append version controls (for both writers and reviewers)
      docDiv.appendChild(versionControls);

      docListDiv.appendChild(docDiv);
    });
  }).catch(err => {
    console.error("Error loading documents:", err);
  });
}

renderDashboard();

// Upload Form Submission for new documents.
const uploadForm = document.getElementById("uploadForm");
if (uploadForm) {
  uploadForm.addEventListener("submit", function (event) {
    event.preventDefault();
    const fileInput = document.getElementById("webhelpZip");
    const file = fileInput.files[0];
    const reviewersInput = document.getElementById("reviewers").value.trim();
    if (!file) {
      alert("Please select a .zip file to upload.");
      return;
    }
    if (reviewersInput === "") {
      alert("Please enter reviewer names (comma separated).");
      return;
    }
    const reviewerNames = reviewersInput.split(",")
      .map(name => name.trim())
      .filter(name => name !== "");
    const formData = new FormData();
    formData.append("webhelpZip", file);
    fetch("/uploadWebhelp", {
      method: "POST",
      body: formData,
    })
      .then(response => response.json())
      .then(data => {
        alert("Upload successful!\n" +
              "Document Title: " + data.title + "\n" +
              "Document ID: " + data.webhelpId + ", Version: " + data.version);
        // Create a new document record.
        const newDoc = {
          docId: data.webhelpId,
          uploader: currentUser,
          reviewers: reviewerNames,
          versions: [
            { webhelpId: data.webhelpId, version: data.version, title: data.title, subFolder: data.subFolder, status: "Under Review" }
          ]
        };
        fetch("/saveDocument", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newDoc)
        })
        .then(() => {
          renderDashboard();
          uploadForm.reset();
        })
        .catch(err => {
          console.error("Error saving document record:", err);
        });
      })
      .catch(error => {
        console.error("Error uploading file:", error);
        alert("Error uploading file.");
      });
  });
}

document.querySelector("#metricsModal .close").addEventListener("click", () => {
  document.getElementById("metricsModal").style.display = "none";
});

// New Version Upload Handling.
document.getElementById("newVersionFile").addEventListener("change", function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const docId = event.target.dataset.docId;
  fetch("/getDocuments")
    .then(response => response.json())
    .then(docs => {
      const doc = docs.find(d => d.docId === docId);
      if (!doc) {
        alert("Document record not found.");
        return;
      }
      const formData = new FormData();
      formData.append("webhelpZip", file);
      formData.append("docId", docId);
      fetch("/uploadWebhelp", {
        method: "POST",
        body: formData,
      })
        .then(response => response.json())
        .then(data => {
          alert("New version upload successful!\n" +
                "Document Title: " + data.title + "\n" +
                "Document ID: " + data.webhelpId + ", Version: " + data.version);
          const newVersion = { 
            webhelpId: data.webhelpId, 
            version: data.version, 
            title: data.title, 
            subFolder: data.subFolder, 
            status: "Under Review" 
          };
          fetch("/updateDocument", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ docId, newVersion })
          })
          .then(() => {
            renderDashboard();
            event.target.value = "";
          })
          .catch(err => {
            console.error("Error updating document record:", err);
          });
        })
        .catch(error => {
          console.error("Error uploading new version:", error);
          alert("Error uploading new version.");
        });
    })
    .catch(err => {
      console.error("Error fetching documents:", err);
    });
});
