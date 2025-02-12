document.addEventListener("DOMContentLoaded", function () {
    // Global variables to store user info
    let currentUser = "";
    let currentRole = "";
  
    // Element references (login page)
    const loginForm = document.getElementById("loginForm");
  
    // ---------------------------
    // LOGIN PROCESS
    // ---------------------------
    if (loginForm) {
      loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const username = document.getElementById("username").value.trim();
        const role = document.getElementById("role").value;
        if (username === "") {
          alert("Please enter a username.");
          return;
        }
        currentUser = username;
        currentRole = role;
  
        // Save current user and role to localStorage for persistent state
        localStorage.setItem("currentUser", currentUser);
        localStorage.setItem("currentRole", currentRole);
  
        // Redirect to the dashboard page after login
        window.location.href = "dashboard.html";
      });
    }
  
    // ---------------------------
    // LOCAL STORAGE HELPERS
    // ---------------------------
    function getAllDocuments() {
      return JSON.parse(localStorage.getItem("allDocuments") || "[]");
    }
    function saveAllDocuments(docs) {
      localStorage.setItem("allDocuments", JSON.stringify(docs));
    }
  
    // (The following code is used only on pages where the upload form exists.)
    const uploadForm = document.getElementById("uploadForm");
    const writerDocumentsDiv = document.getElementById("writerDocuments");
    const reviewerDocumentsDiv = document.getElementById("reviewerDocuments");
  
    // ---------------------------
    // UPLOAD PROCESS (FILE + REVIEWER NAMES)
    // ---------------------------
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
        // Process reviewer names into an array
        const reviewerNames = reviewersInput
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name !== "");
  
        // Create a FormData object to send the file
        const formData = new FormData();
        formData.append("webhelpZip", file);
  
        // Send the file to the server endpoint /uploadWebhelp
        fetch("/uploadWebhelp", {
          method: "POST",
          body: formData,
        })
          .then((response) => response.json())
          .then((data) => {
            // Expected server response: { webhelpId, version, title, subFolder }
            alert(
              "Upload successful!\n" +
                "Document Title: " + data.title + "\n" +
                "Document ID: " + data.webhelpId + ", Version: " + data.version
            );
            // Create a document record including subFolder
            const newDoc = {
              webhelpId: data.webhelpId,
              version: data.version,
              title: data.title,
              subFolder: data.subFolder, // Stores the dynamic subfolder name.
              uploader: currentUser,
              reviewers: reviewerNames,
              status: "Under Review" // Default status
            };
  
            let allDocs = getAllDocuments();
            allDocs.push(newDoc);
            localStorage.setItem("allDocuments", JSON.stringify(allDocs));
            // Redirect to the dashboard page after upload
            window.location.href = "dashboard.html";
          })
          .catch((error) => {
            console.error("Error uploading file:", error);
            alert("Error uploading file.");
          });
      });
    }
  });
  