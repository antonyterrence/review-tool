document.addEventListener('DOMContentLoaded', function() {
  /************************************************
   * Global Variables and Topic Identification
   ************************************************/
  const params = new URLSearchParams(window.location.search);
  window.webhelpId = params.get("webhelpId");
  window.version = params.get("version"); // e.g. "v2"
  window.subFolder = params.get("subFolder");
  let showPreviousComments = false;
  let currentTopic = localStorage.getItem("currentTopic") || "default";
  let newAnnotationCount = 0;
  
  let selectedText = '';
  let selectedRange = null;
  
  const globalActiveUsers = {};  
  const currentUserAnnotation = localStorage.getItem("currentUser") || "User1";
  
  const topicContent = document.getElementById("topicContent");
  window.currentVersion = version;
  
  /************************************************
   * Version Selector Setup
   ************************************************/
  const currentVersionNum = parseInt(version.substring(1)) || 1;
  const versionSelect = document.getElementById("versionSelect");
  versionSelect.innerHTML = "";
  for (let i = 1; i <= currentVersionNum; i++) {
    const opt = document.createElement("option");
    opt.value = "v" + i;
    opt.textContent = "v" + i;
    versionSelect.appendChild(opt);
  }
  if (currentVersionNum > 1) {
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "All Versions";
    versionSelect.appendChild(allOpt);
  }
  versionSelect.value = version;
  
  loadAnnotationsFromServer(currentTopic, false, version);
  
  /************************************************
   * Socket.IO Integration
   ************************************************/
  window.socket = io();
  socket.on('connect', () => {
    console.log('Connected to Socket.IO server:', socket.id);
    const room = 'document-' + webhelpId + '-' + currentVersion;
    socket.emit('joinRoom', room);
    globalActiveUsers[socket.id] = { user: currentUserAnnotation, lastUpdate: Date.now() };
    updateGlobalActiveUsersDisplay();
  });
  
  socket.on('cursor-update', (data) => {
    console.log('Received cursor update:', data);
  });
  
  /************************************************
   * Global and Topic Cursor Indicators
   ************************************************/
  const topicCursorMarkers = {};
  
  
  const otherCursorMarkers = {};
  socket.on('cursor-update', (data) => {
    if (data.id === socket.id) return;
    globalActiveUsers[data.id] = { user: data.user, lastUpdate: Date.now() };
    updateGlobalActiveUsersDisplay();
    if (data.currentTopic === currentTopic) {
      let marker = topicCursorMarkers[data.id];
      if (!marker) {
        marker = document.createElement('div');
        marker.className = 'topic-cursor-marker';
        const label = document.createElement('div');
        label.className = 'cursor-label';
        label.textContent = data.user;
        marker.appendChild(label);
        topicContent.appendChild(marker);
        topicCursorMarkers[data.id] = marker;
      }
      const rect = topicContent.getBoundingClientRect();
      marker.style.left = (data.cursorX - rect.left) + 'px';
      marker.style.top = (data.cursorY - rect.top) + 'px';
      marker.dataset.lastUpdate = Date.now();
    } else {
      if (topicCursorMarkers[data.id]) {
        topicCursorMarkers[data.id].remove();
        delete topicCursorMarkers[data.id];
      }
    }
  });
  
  setInterval(() => {
    const now = Date.now();
    Object.keys(globalActiveUsers).forEach(id => {
      if (id !== socket.id && now - globalActiveUsers[id].lastUpdate > 5000) {
        delete globalActiveUsers[id];
      }
    });
    updateGlobalActiveUsersDisplay();
    Object.keys(topicCursorMarkers).forEach(id => {
      const marker = topicCursorMarkers[id];
      if (now - marker.dataset.lastUpdate > 5000) {
        marker.remove();
        delete topicCursorMarkers[id];
      }
    });
  }, 5000);
  
 
  
  /************************************************
   * TOC & Topic Loading
   ************************************************/
  if (!webhelpId || !version || !subFolder) {
    document.getElementById("tocList").innerHTML = "<p>Missing document parameters.</p>";
    document.getElementById("topicContent").innerHTML = "<p>Cannot load document.</p>";
  } else {
    const indexUrl = `/webhelp/${webhelpId}/${version}/${subFolder}/index.html`;
    fetch(indexUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error("Network response was not ok: " + response.statusText);
        }
        return response.text();
      })
      .then(html => {
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        const tocList = document.getElementById("tocList");
        tocList.innerHTML = "";
        const tocElement = tempDiv.querySelector("nav ul.map");
        if (tocElement) {
          tocList.innerHTML = tocElement.outerHTML;
          const tocLinks = tocList.querySelectorAll("a");
          tocLinks.forEach(link => {
            link.addEventListener("click", function(event) {
              event.preventDefault();
              let href = this.getAttribute("href");
              currentTopic = href.replace('.html','');
              localStorage.setItem("currentTopic", currentTopic);
              const topicUrl = `/webhelp/${webhelpId}/${currentVersion}/${subFolder}/${href}`;
              fetch(topicUrl)
                .then(resp => {
                  if (!resp.ok) {
                    throw new Error("Network response was not ok: " + resp.statusText);
                  }
                  return resp.text();
                })
                .then(topicHtml => {
                  document.getElementById("topicContent").innerHTML = topicHtml;
                  overrideTopicLinks();
                  loadAnnotationsFromServer(currentTopic);
                })
                .catch(err => {
                  console.error("Error loading topic:", err);
                  document.getElementById("topicContent").innerHTML = "<p>Error loading topic.</p>";
                });
            });
          });
          if (tocLinks.length > 0) {
            let found = false;
            tocLinks.forEach(link => {
              if (link.getAttribute("href").replace('.html','') === currentTopic) {
                link.click();
                found = true;
              }
            });
            if (!found) {
              tocLinks[0].click();
            }
          }
        } else {
          const headings = tempDiv.querySelectorAll("h2");
          const tocList = document.getElementById("tocList");
          if (headings.length === 0) {
            tocList.innerHTML = "<p>No TOC found.</p>";
          } else {
            headings.forEach((heading, idx) => {
              const tocItem = document.createElement("div");
              tocItem.className = "tocItem";
              tocItem.textContent = heading.textContent;
              tocItem.addEventListener("click", () => {
                currentTopic = "topic" + (idx + 1);
                localStorage.setItem("currentTopic", currentTopic);
                const topicUrl = `/webhelp/${webhelpId}/${currentVersion}/${subFolder}/topic${idx + 1}.html`;
                fetch(topicUrl)
                  .then(resp => {
                    if (!resp.ok) {
                      throw new Error("Network response was not ok: " + resp.statusText);
                    }
                    return resp.text();
                  })
                  .then(topicHtml => {
                    document.getElementById("topicContent").innerHTML = topicHtml;
                    overrideTopicLinks();
                    loadAnnotationsFromServer(currentTopic);
                  })
                  .catch(err => {
                    console.error("Error loading topic:", err);
                    document.getElementById("topicContent").innerHTML = "<p>Error loading topic.</p>";
                  });
              });
              tocList.appendChild(tocItem);
            });
            if (headings.length > 0) {
              tocList.querySelector(".tocItem").click();
            }
          }
        }
      })
      .catch(error => {
        console.error("Error loading index.html:", error);
        document.getElementById("tocList").innerHTML = "<p>Error loading TOC.</p>";
        document.getElementById("topicContent").innerHTML = "<p>Error loading document content.</p>";
      });
  }
  
  
  
  /************************************************
   * Annotation, Context Menu, and Review Panel Features
   ************************************************/
  const contextMenu = document.getElementById("contextMenu");
  const overlay = document.getElementById("overlay");
  let currentReplyTarget = null;
  let currentEditTarget = null;
  window.annotationMap = new Map();
  let reviewItems = [];
  
  topicContent.addEventListener('mousemove', (event) => {
    const room = 'document-' + webhelpId + '-' + currentVersion;
    socket.emit('cursor-update', { 
      room, 
      cursorX: event.clientX, 
      cursorY: event.clientY, 
      user: currentUserAnnotation, 
      currentTopic: currentTopic 
    });
  });
  
  
  
  window.addEventListener("load", () => {
    loadAnnotationsFromServer(currentTopic);
  });
  
  topicContent.addEventListener('mouseup', (event) => {
    const selection = window.getSelection();
    if (selection.toString().trim() && topicContent.contains(selection.anchorNode)) {
      selectedText = selection.toString();
      selectedRange = selection.getRangeAt(0);
      contextMenu.style.display = 'block';
      contextMenu.style.left = `${event.pageX}px`;
      contextMenu.style.top = `${event.pageY}px`;
    }
  });
  
  document.addEventListener('mousedown', (event) => {
    if (!contextMenu.contains(event.target)) {
      contextMenu.style.display = 'none';
    }
  });
  
  versionSelect.addEventListener("change", function() {
    const selected = this.value;
    if (selected === "all") {
      currentVersion = version;
      loadAnnotationsFromServer(currentTopic, true, currentVersion);
    } else {
      currentVersion = selected;
      loadAnnotationsFromServer(currentTopic, false, currentVersion);
    }
  });
  
  
  
  // Ellipsis menu with options: Edit, Delete, Accept, Reject, Resolve
  // Updated ellipsis menu event listener with rebuildAnnotation helper
document.addEventListener("click", function(event) {
  if (event.target && event.target.classList.contains("ellipsis-btn")) {
    event.stopPropagation();
    const existingMenu = document.querySelector(".comment-options-menu");
    if (existingMenu) {
      existingMenu.parentNode.removeChild(existingMenu);
      return;
    }
    const parentAnnotation = event.target.closest(".review-item");
    if (!parentAnnotation) return;
    const annotationType = parentAnnotation.dataset.type;
    const annotationId = parentAnnotation.dataset.itemId;

    const menu = document.createElement("div");
    menu.className = "comment-options-menu";
    menu.style.position = "fixed";
    menu.style.background = "white";
    menu.style.border = "1px solid #ccc";
    menu.style.boxShadow = "2px 2px 5px rgba(0,0,0,0.2)";
    menu.style.padding = "2px";
    menu.style.zIndex = "2000";
    menu.style.opacity = "0";
    menu.style.transition = "opacity 0.2s ease, transform 0.2s ease";

    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.style.margin = "2px 0";

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.style.margin = "2px 0";

    const acceptBtn = document.createElement("button");
    acceptBtn.textContent = "Accept";
    acceptBtn.style.margin = "2px 0";

    const rejectBtn = document.createElement("button");
    rejectBtn.textContent = "Reject";
    rejectBtn.style.margin = "2px 0";

    const resolveBtn = document.createElement("button");
    resolveBtn.textContent = "Resolve";
    resolveBtn.style.margin = "2px 0";

    if (annotationType === "comment") {
      menu.appendChild(editBtn);
    }
    menu.appendChild(deleteBtn);
    menu.appendChild(acceptBtn);
    menu.appendChild(rejectBtn);
    menu.appendChild(resolveBtn);

    const rect = event.target.getBoundingClientRect();
    const menuWidth = 150;
    if (rect.right + menuWidth > window.innerWidth) {
      menu.style.left = (rect.left - menuWidth + 2) + "px";
    } else {
      menu.style.left = (rect.right - 2) + "px";
    }
    menu.style.top = (rect.top + 2) + "px";

    document.body.appendChild(menu);
    requestAnimationFrame(() => {
      menu.style.opacity = "1";
      menu.style.transform = "translateY(0px)";
    });

    editBtn.addEventListener("click", function() {
      const textElem = parentAnnotation.querySelector(".text");
      if (textElem) {
        document.getElementById('editText').value = textElem.textContent;
      }
      currentEditTarget = parentAnnotation;
      showModal('editModal');
      removeMenu();
    });

    deleteBtn.addEventListener("click", function() {
      let annotationObj = reviewItems.find(item => item.id === annotationId);
      if (!annotationObj) {
        annotationObj = rebuildAnnotation(parentAnnotation);
      }
      if (annotationObj) {
        annotationObj.status = "deleted";
      }
      parentAnnotation.remove();
      revertAnnotationText(annotationType, annotationId);
      annotationMap.delete(annotationId);
      reviewItems = reviewItems.filter(item => item.id !== annotationId);
      saveAnnotationToServer(annotationObj, currentTopic);
      removeMenu();
    });

    acceptBtn.addEventListener("click", function() {
      let annotationObj = reviewItems.find(item => item.id === annotationId);
      if (!annotationObj) {
        annotationObj = rebuildAnnotation(parentAnnotation);
      }
      if (annotationObj) {
        annotationObj.status = "accepted";
        addAnnotationStatusIcon(parentAnnotation, "accepted");
        saveAnnotationToServer(annotationObj, currentTopic);
      }
      removeMenu();
    });

    rejectBtn.addEventListener("click", function() {
      let annotationObj = reviewItems.find(item => item.id === annotationId);
      if (!annotationObj) {
        annotationObj = rebuildAnnotation(parentAnnotation);
      }
      if (annotationObj) {
        annotationObj.status = "rejected";
        addAnnotationStatusIcon(parentAnnotation, "rejected");
        saveAnnotationToServer(annotationObj, currentTopic);
      }
      removeMenu();
    });

    resolveBtn.addEventListener("click", function() {
      let annotationObj = reviewItems.find(item => item.id === annotationId);
      if (!annotationObj) {
        annotationObj = rebuildAnnotation(parentAnnotation);
      }
      if (annotationObj) {
        annotationObj.status = "resolved";
        parentAnnotation.style.display = "none";
        saveAnnotationToServer(annotationObj, currentTopic);
      }
      removeMenu();
    });

    document.addEventListener("click", function handler(ev) {
      if (!menu.contains(ev.target)) {
        removeMenu();
        document.removeEventListener("click", handler);
      }
    });

    function removeMenu() {
      if (menu.parentNode) {
        menu.parentNode.removeChild(menu);
      }
    }

    function rebuildAnnotation(element) {
      if (!element) return null;
      const rebuilt = {
        id: element.dataset.itemId,
        type: element.dataset.type,
        text: element.querySelector('.text') ? element.querySelector('.text').textContent : "",
        user: currentUserAnnotation,
        timestamp: new Date().toLocaleString(),
        range: element.dataset.range ? JSON.parse(element.dataset.range) : undefined
      };
      reviewItems.push(rebuilt);
      return rebuilt;
    }
  }
});
  
  

  // Listen for annotation changes from other clients.
// When another client makes a change, we reload annotations.
socket.on('annotation-change', (data) => {
  // Ignore events sent by this client.
  if (data.id === socket.id) return;
  // If the change is not for the current topic, ignore it.
  if (data.topic && data.topic !== currentTopic) return;
  console.log('Received annotation change from another client:', data);
  newAnnotationCount++;
  updateCheckCommentsButton();
});


const checkCommentsButton = document.getElementById("checkCommentsButton");
checkCommentsButton.addEventListener("click", function() {
  loadAnnotationsFromServer(currentTopic);
  newAnnotationCount = 0;
  updateCheckCommentsButton();
});

function updateCheckCommentsButton() {
  if (newAnnotationCount > 0) {
    checkCommentsButton.textContent = `Check for comments (${newAnnotationCount})`;
  } else {
    checkCommentsButton.textContent = "Check for comments";
  }
}

  
  /*
  function saveAnnotationToServer(changeObj, topic) {
    console.log("Calling saveAnnotationToServer", changeObj);
    if (!topic) {
      topic = "default";
    }
    fetch('/saveReviewChange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        webhelpId: webhelpId,
        version: currentVersion,
        topic: topic,
        change: changeObj
      })
    })
    .then(response => response.json())
    .then(data => {
      console.log("Annotation saved on server:", data);
    })
    .catch(error => {
      console.error("Error saving annotation to server:", error);
    });
  }*/
 // In your saveAnnotationToServer function, add an emit so that changes
// are sent to other clients in the same room.

  // Inline Reply & Edit Handlers (unchanged)
  document.getElementById('reviewList').addEventListener('input', function(event) {
    if (event.target.classList.contains('reply-textarea')) {
      const inlineReplyDiv = event.target.closest('.inline-reply');
      const postBtn = inlineReplyDiv.querySelector('.reply-post');
      const cancelBtn = inlineReplyDiv.querySelector('.reply-cancel');
      if (event.target.value.trim().length > 0) {
        postBtn.disabled = false;
        cancelBtn.disabled = false;
        postBtn.style.fontWeight = 'bold';
      } else {
        postBtn.disabled = true;
        cancelBtn.disabled = true;
        postBtn.style.fontWeight = 'normal';
      }
    }
    if (event.target.classList.contains('reply-edit-textarea')) {
      const editContainer = event.target.closest('.reply-edit-container');
      const saveBtn = editContainer.querySelector('.reply-edit-save');
      if (event.target.value.trim().length > 0) {
        saveBtn.disabled = false;
        saveBtn.style.fontWeight = 'bold';
      } else {
        saveBtn.disabled = true;
        saveBtn.style.fontWeight = 'normal';
      }
    }
  });
  
  document.getElementById('reviewList').addEventListener('click', function(event) {
    if (event.target.classList.contains('reply-edit-btn')) {
      const replyItem = event.target.closest('.reply-item');
      const replyTextDiv = replyItem.querySelector('.reply-text');
      replyTextDiv.style.display = 'none';
      let editContainer = replyItem.querySelector('.reply-edit-container');
      if (!editContainer) {
        editContainer = document.createElement('div');
        editContainer.classList.add('reply-edit-container');
        editContainer.innerHTML = `
          <textarea class="reply-edit-textarea">${replyTextDiv.textContent}</textarea>
          <div class="reply-edit-buttons">
            <button class="reply-edit-cancel small-btn">Cancel</button>
            <button class="reply-edit-save small-btn" disabled>Save</button>
          </div>
        `;
        replyItem.appendChild(editContainer);
      } else {
        const textarea = editContainer.querySelector('.reply-edit-textarea');
        textarea.value = replyTextDiv.textContent;
        editContainer.style.display = 'block';
      }
    }
  
    if (event.target.classList.contains('reply-edit-cancel')) {
      const editContainer = event.target.closest('.reply-edit-container');
      editContainer.style.display = 'none';
      const replyItem = event.target.closest('.reply-item');
      const replyTextDiv = replyItem.querySelector('.reply-text');
      replyTextDiv.style.display = 'block';
    }
  
    if (event.target.classList.contains('reply-edit-save')) {
      const editContainer = event.target.closest('.reply-edit-container');
      const textarea = editContainer.querySelector('.reply-edit-textarea');
      const newText = textarea.value.trim();
      if (newText) {
        const replyItem = event.target.closest('.reply-item');
        const replyTextDiv = replyItem.querySelector('.reply-text');
        replyTextDiv.textContent = newText;
        replyTextDiv.style.display = 'block';
        editContainer.style.display = 'none';
  
        // Find the reply annotation in reviewItems using its data attribute.
        let replyAnnotation = reviewItems.find(item => item.id === replyItem.dataset.itemId);
        if (replyAnnotation) {
          replyAnnotation.text = newText;
          replyAnnotation.timestamp = new Date().toLocaleString();
        } else {
          // Fallback: rebuild the reply annotation from the DOM.
          replyAnnotation = {
            id: replyItem.dataset.itemId,
            type: replyItem.dataset.type, // should be 'reply'
            text: newText,
            user: currentUserAnnotation,
            timestamp: new Date().toLocaleString(),
            parentId: replyItem.closest('.review-item').dataset.itemId
          };
          reviewItems.push(replyAnnotation);
        }
        // Save the updated reply annotation to the server.
        saveAnnotationToServer(replyAnnotation, currentTopic);
      }
    }
  
    if (event.target.classList.contains('reply-post')) {
      const inlineReplyDiv = event.target.closest('.inline-reply');
      const textarea = inlineReplyDiv.querySelector('.reply-textarea');
      const replyText = textarea.value.trim();
      if (replyText) {
        const parentCommentElement = event.target.closest('.review-item');
        const parentId = parentCommentElement.dataset.itemId;
        const reply = {
          id: Date.now().toString(),
          type: 'reply',
          user: currentUserAnnotation,
          text: replyText,
          timestamp: new Date().toLocaleString(),
          parentId: parentId,
        };
        const replyElement = createReplyItem(reply);
        let replyContainer = parentCommentElement.querySelector('.reply-container');
        if (!replyContainer) {
          replyContainer = document.createElement('div');
          replyContainer.className = 'reply-container';
          parentCommentElement.appendChild(replyContainer);
        }
        replyContainer.appendChild(replyElement);
        reviewItems.push(reply);
        saveAnnotationToServer(reply, currentTopic);
        textarea.value = '';
        event.target.disabled = true;
        inlineReplyDiv.querySelector('.reply-cancel').disabled = true;
        event.target.style.fontWeight = 'normal';
      }
    }
  
    if (event.target.classList.contains('reply-cancel')) {
      const inlineReplyDiv = event.target.closest('.inline-reply');
      const textarea = inlineReplyDiv.querySelector('.reply-textarea');
      textarea.value = '';
      const postBtn = inlineReplyDiv.querySelector('.reply-post');
      const cancelBtn = inlineReplyDiv.querySelector('.reply-cancel');
      postBtn.disabled = true;
      cancelBtn.disabled = true;
      postBtn.style.fontWeight = 'normal';
    }
  });
  
  
  document.getElementById('submitComment').addEventListener('click', () => {
    const text = document.getElementById('commentText').value.trim();
    if (text && selectedRange) {
      const commentId = Date.now().toString();
      const serialized = advancedSerializeRange(selectedRange.cloneRange());
      const comment = {
        id: commentId,
        type: 'comment',
        user: currentUserAnnotation,
        text: text,
        timestamp: new Date().toLocaleString(),
        range: serialized
      };
      const commentSpan = document.createElement("span");
      commentSpan.className = "comment-marker";
      commentSpan.dataset.commentId = commentId;
      commentSpan.innerHTML = serialized.html;
      selectedRange.deleteContents();
      selectedRange.insertNode(commentSpan);
      annotationMap.set(commentId, commentSpan);
      const reviewItem = createReviewItem('comment', comment);
      document.getElementById('reviewList').appendChild(reviewItem);
      reviewItems.push(comment);
      saveAnnotationToServer(comment, currentTopic);
      closeModals();
    }
  });
  
  document.getElementById('submitReply').addEventListener('click', () => {
    const text = document.getElementById('replyText').value.trim();
    if (text && currentReplyTarget) {
      const reply = {
        id: Date.now().toString(),
        type: 'comment',
        user: currentUserAnnotation,
        text: text,
        timestamp: new Date().toLocaleString(),
        parentId: currentReplyTarget.dataset.itemId,
        range: annotationMap.get(currentReplyTarget.dataset.itemId)
      };
      const replyElement = createReviewItem('comment', reply);
      const repliesContainer = currentReplyTarget.querySelector('.replies');
      repliesContainer.appendChild(replyElement);
      const parentComment = reviewItems.find(item => item.id === currentReplyTarget.dataset.itemId);
      if (parentComment) {
        parentComment.replies = parentComment.replies || [];
        parentComment.replies.push(reply);
      }
      annotationMap.set(reply.id, reply.range);
      saveAnnotationToServer(reply, currentTopic);
      closeModals();
    }
  });
  
  /*document.getElementById('submitEdit').addEventListener('click', () => {
    const text = document.getElementById('editText').value.trim();
    if (text && currentEditTarget) {
      const textElem = currentEditTarget.querySelector('.text');
      if (textElem) {
        textElem.textContent = text;
      }
      const comment = reviewItems.find(item => item.id === currentEditTarget.dataset.itemId);
      if (comment) comment.text = text;
      saveAnnotationToServer(comment, currentTopic);
      closeModals();
    }
  });*/

  document.getElementById('submitEdit').addEventListener('click', () => {
    const newText = document.getElementById('editText').value.trim();
    if (newText && currentEditTarget) {
      // Update the DOM element's text.
      const textElem = currentEditTarget.querySelector('.text');
      if (textElem) {
        textElem.textContent = newText;
      }
      // Try to find the annotation object in reviewItems.
      let annotation = reviewItems.find(item => item.id === currentEditTarget.dataset.itemId);
      if (annotation) {
        // Only update the text and timestamp.
        annotation.text = newText;
        annotation.timestamp = new Date().toLocaleString();
      } else {
        // Fallback: rebuild the annotation object using the data stored on the DOM element.
        console.warn("Annotation not found in reviewItems; rebuilding annotation object.");
        annotation = {
          id: currentEditTarget.dataset.itemId,
          type: currentEditTarget.dataset.type,
          text: newText,
          user: currentUserAnnotation, // assuming currentUserAnnotation is defined
          timestamp: new Date().toLocaleString(),
          // Preserve the range if it was stored as a data attribute.
          range: currentEditTarget.dataset.range ? JSON.parse(currentEditTarget.dataset.range) : undefined
        };
        // Add the rebuilt annotation to reviewItems.
        reviewItems.push(annotation);
      }
      // Send the updated annotation to the server.
      saveAnnotationToServer(annotation, currentTopic);
      closeModals();
    }
  });
  
  
  
  
  document.getElementById('cancelReply').addEventListener('click', closeModals);
  document.getElementById('cancelEdit').addEventListener('click', closeModals);
  document.getElementById('cancelComment').addEventListener('click', closeModals);
  document.getElementById('replaceCancel').addEventListener('click', closeModals);
  
  document.getElementById('highlightButton').addEventListener('click', () => {
    if (selectedRange) {
      const highlightId = Date.now().toString();
      const serialized = advancedSerializeRange(selectedRange.cloneRange());
      const highlight = {
        id: highlightId,
        type: 'highlight',
        user: currentUserAnnotation,
        highlightedHtml: serialized.html,
        timestamp: new Date().toLocaleString(),
        range: serialized
      };
      const span = document.createElement('span');
      span.className = 'annotator-hl';
      span.innerHTML = serialized.html;
      selectedRange.deleteContents();
      selectedRange.insertNode(span);
      const item = createReviewItem('highlight', highlight);
      document.getElementById('reviewList').appendChild(item);
      reviewItems.push(highlight);
      annotationMap.set(highlight.id, highlight.range);
      contextMenu.style.display = 'none';
      saveAnnotationToServer(highlight, currentTopic);
    }
  });
  
  document.getElementById('deleteButton').addEventListener('click', () => {
    if (selectedRange) {
      const deletionId = Date.now().toString();
      const serialized = advancedSerializeRange(selectedRange.cloneRange());
      const deletion = {
        id: deletionId,
        type: 'deletion',
        user: currentUserAnnotation,
        deletedHtml: serialized.html,
        timestamp: new Date().toLocaleString(),
        range: serialized
      };
      const span = document.createElement('span');
      span.className = 'deleted-text';
      span.innerHTML = serialized.html;
      selectedRange.deleteContents();
      selectedRange.insertNode(span);
      const item = createReviewItem('deletion', deletion);
      document.getElementById('reviewList').appendChild(item);
      reviewItems.push(deletion);
      annotationMap.set(deletion.id, deletion.range);
      contextMenu.style.display = 'none';
      saveAnnotationToServer(deletion, currentTopic);
    }
  });
  
  document.getElementById('replaceConfirm').addEventListener('click', () => {
    const newText = document.getElementById('replaceTo').value.trim();
    if (newText && selectedRange) {
      const replacementId = Date.now().toString();
      const serialized = advancedSerializeRange(selectedRange.cloneRange());
      const replacement = {
        id: replacementId,
        type: 'replacement',
        user: currentUserAnnotation,
        oldHtml: serialized.html,
        newText: newText,
        timestamp: new Date().toLocaleString(),
        range: serialized
      };
      const deletedSpan = document.createElement('span');
      deletedSpan.className = 'deleted-text';
      deletedSpan.dataset.deletionId = replacementId;
      deletedSpan.innerHTML = serialized.html;
      const insertedSpan = document.createElement('span');
      insertedSpan.className = 'inserted-text';
      insertedSpan.textContent = newText;
      selectedRange.deleteContents();
      selectedRange.insertNode(deletedSpan);
      selectedRange.insertNode(document.createTextNode(' '));
      selectedRange.insertNode(insertedSpan);
      const item = createReviewItem('replacement', replacement);
      document.getElementById('reviewList').appendChild(item);
      reviewItems.push(replacement);
      annotationMap.set(replacement.id, replacement.range);
      closeModals();
      saveAnnotationToServer(replacement, currentTopic);
    }
  });
  
  document.getElementById('reviewList').addEventListener('click', (e) => {
    const item = e.target.closest('.review-item');
    if (!item) return;
    if (item.dataset.type === 'comment') {
      const commentId = item.dataset.itemId;
      const marker = document.querySelector(`#topicContent .comment-marker[data-comment-id="${commentId}"]`);
      if (marker) {
        marker.classList.add("temp-highlight");
        marker.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => marker.classList.remove("temp-highlight"), 2000);
      }
      if (e.target.classList.contains('reply-btn')) {
        currentReplyTarget = item;
        showModal('replyModal');
      }
      if (e.target.classList.contains('edit-btn')) {
        currentEditTarget = item;
        const textElem = item.querySelector('.text');
        if (textElem) {
          document.getElementById('editText').value = textElem.textContent;
        }
        showModal('editModal');
      }
    }
  });
  
  document.getElementById('reviewList').addEventListener('mouseover', (e) => {
    const item = e.target.closest('.review-item');
    if (!item) return;
    const type = item.dataset.type;
    const id = item.dataset.itemId;
    if (type === 'deletion' || type === 'replacement' || type === 'highlight') {
      let marker = document.querySelector(`[data-deletion-id="${id}"]`) || document.querySelector(`[data-highlight-id="${id}"]`);
      if (marker) {
        marker.classList.add("temp-highlight");
      }
    }
  });
  
  document.getElementById('reviewList').addEventListener('mouseout', (e) => {
    const item = e.target.closest('.review-item');
    if (!item) return;
    const type = item.dataset.type;
    const id = item.dataset.itemId;
    if (type === 'deletion' || type === 'replacement' || type === 'highlight') {
      let marker = document.querySelector(`[data-deletion-id="${id}"]`) || document.querySelector(`[data-highlight-id="${id}"]`);
      if (marker) {
        marker.classList.remove("temp-highlight");
      }
    }
  });
  
  document.getElementById('commentButton').addEventListener('click', () => {
    showModal('speechBubble');
  });
  
  document.getElementById('replaceButton').addEventListener('click', () => {
    document.getElementById('replaceFrom').value = selectedText;
    showModal('replaceModal');
  });
  
 
});
