# A custom web-based Content Review Tool – Workflow
* Generate HTML5 output using Oxygen (Current design).
* Log in as a writer, specify the reviewers' names, zip the output, and upload it.
  * Documents are versioned on the server.
  * Writers can upload a new version of an existing document.
* Log in as a reviewer and open a document to review:
  * Reviewers can comment, edit, and replace text.
  * Suggestions and changes are tracked and stored on the server.
## Tech details:
* A simple Node.js web app prototype
* Stores tracked changes in annotations.json file on the server. A separate annotation.json file is created for each document uploaded.
* Document versions are tracked through documents.json file on the server

* SSO-enabled access to the site
Commenting facility at each html element
Concurrent review
Retain the comments when the page is refreshed
Comments Summary for each publication
Closed / Open / In progress / On hold comments count per publication
Download the comments
Archival of closed comments
Tag the stakeholders
Automated emails for name tagging, comment status updates

