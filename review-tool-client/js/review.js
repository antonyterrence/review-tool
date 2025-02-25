document.addEventListener('DOMContentLoaded', function() {
  const params = new URLSearchParams(window.location.search);
  window.webhelpId = params.get("webhelpId");
  window.version = params.get("version");
  window.subFolder = params.get("subFolder");
  let showPreviousComments = false;
  window.currentTopic = localStorage.getItem("currentTopic") || "default";
  window.newAnnotationCount = 0;
  
  window.selectedText = '';
  window.selectedRange = null;
  
  window.globalActiveUsers = {};  
  window.currentUserAnnotation = localStorage.getItem("currentUser") || "User1";
  const currentRole = localStorage.getItem("currentRole") || "user";
  
  window.topicContent = document.getElementById("topicContent");
  window.currentVersion = version;

  const versionSelect = document.getElementById("versionSelect");
  const currentVersionNum = parseInt(version.substring(1)) || 1;
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

  const topicCursorMarkers = {};
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

  const tocContextMenu = document.createElement('div');
  tocContextMenu.id = 'tocContextMenu';
  tocContextMenu.innerHTML = '<button id="markReviewTopic">Mark for Review</button>';
  document.body.appendChild(tocContextMenu);

  if (!webhelpId || !version || !subFolder) {
    document.getElementById("tocList").innerHTML = "<p>Missing document parameters.</p>";
    document.getElementById("topicContent").innerHTML = "<p>Cannot load document.</p>";
  } else {
    const indexUrl = `/webhelp/${webhelpId}/${version}/${subFolder}/index.html`;
    fetch(indexUrl)
      .then(response => {
        if (!response.ok) throw new Error("Network response was not ok: " + response.statusText);
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
                  if (!resp.ok) throw new Error("Network response was not ok: " + resp.statusText);
                  return resp.text();
                })
                .then(topicHtml => {
                  document.getElementById("topicContent").innerHTML = topicHtml;
                  overrideTopicLinks();
                  loadAnnotationsFromServer(currentTopic);
                  loadReviewMarks();
                })
                .catch(err => {
                  console.error("Error loading topic:", err);
                  document.getElementById("topicContent").innerHTML = "<p>Error loading topic.</p>";
                });
            });
            link.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              const topic = link.getAttribute('href').replace('.html', '');
              tocContextMenu.style.display = 'block';
              tocContextMenu.style.left = `${e.pageX}px`;
              tocContextMenu.style.top = `${e.pageY}px`;
              document.getElementById('markReviewTopic').onclick = () => {
                const needsReview = !link.classList.contains('needs-review');
                fetch('/markTopicForReview', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ webhelpId, version: currentVersion, topic, needsReview, user: currentUserAnnotation })
                }).then(() => {
                  link.classList.toggle('needs-review', needsReview);
                  tocContextMenu.style.display = 'none';
                });
              };
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
            if (!found) tocLinks[0].click();
          }
          updateTOCWithReviewStatus();
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
                    if (!resp.ok) throw new Error("Network response was not ok: " + resp.statusText);
                    return resp.text();
                  })
                  .then(topicHtml => {
                    document.getElementById("topicContent").innerHTML = topicHtml;
                    overrideTopicLinks();
                    loadAnnotationsFromServer(currentTopic);
                    loadReviewMarks();
                  })
                  .catch(err => {
                    console.error("Error loading topic:", err);
                    document.getElementById("topicContent").innerHTML = "<p>Error loading topic.</p>";
                  });
              });
              tocItem.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const topic = "topic" + (idx + 1);
                tocContextMenu.style.display = 'block';
                tocContextMenu.style.left = `${e.pageX}px`;
                tocContextMenu.style.top = `${e.pageY}px`;
                document.getElementById('markReviewTopic').onclick = () => {
                  const needsReview = !tocItem.classList.contains('needs-review');
                  fetch('/markTopicForReview', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ webhelpId, version: currentVersion, topic, needsReview, user: currentUserAnnotation })
                  }).then(() => {
                    tocItem.classList.toggle('needs-review', needsReview);
                    tocContextMenu.style.display = 'none';
                  });
                };
              });
              tocList.appendChild(tocItem);
            });
            if (headings.length > 0) tocList.querySelector(".tocItem").click();
          }
          updateTOCWithReviewStatus();
        }
      })
      .catch(error => {
        console.error("Error loading index.html:", error);
        document.getElementById("tocList").innerHTML = "<p>Error loading TOC.</p>";
        document.getElementById("topicContent").innerHTML = "<p>Error loading document content.</p>";
      });
  }

  document.addEventListener('click', (e) => {
    if (!tocContextMenu.contains(e.target)) tocContextMenu.style.display = 'none';
  });

  socket.on('topic-review-update', ({ topic, needsReview }) => {
    const link = document.querySelector(`#tocList a[href="${topic}.html"], #tocList .tocItem[textContent*="${topic}"]`);
    if (link) link.classList.toggle('needs-review', needsReview);
  });

  const contextMenu = document.getElementById("contextMenu");
  const overlay = document.getElementById("overlay");
  let currentReplyTarget = null;
  let currentEditTarget = null;
  window.annotationMap = new Map();
  window.reviewItems = [];

  const header = document.querySelector('header');
 
 
  
  const copyLinksBtn = document.createElement('button');
  copyLinksBtn.textContent = 'Copy Review Links';
  copyLinksBtn.className = 'small-btn';
  document.querySelector('header .header-container').appendChild(copyLinksBtn);


  copyLinksBtn.addEventListener('click', () => {
    // Fetch topic-level review marks
    fetch(`/getTopicsForReview/${webhelpId}/${currentVersion}`)
      .then(response => response.json())
      .then(topicReviews => {
        const topicLevelLinks = Object.entries(topicReviews)
          .filter(([_, data]) => data.needsReview)
          .map(([topic]) => `${window.location.origin}/review.html?webhelpId=${webhelpId}&version=${currentVersion}&subFolder=${subFolder}&topic=${topic}`);
  
        // Gather element-level links by iterating over TOC links
        const tocLinks = document.querySelectorAll("#tocList a");
        const elementLinkPromises = Array.from(tocLinks).map(link => {
          const topic = link.getAttribute("href").replace('.html', '');
          return fetch(`/getReviewMarks/${webhelpId}/${currentVersion}/${encodeURIComponent(topic)}`)
            .then(resp => resp.json())
            .then(marks => {
              // If there are any element-level marks, generate a link for that topic
              return marks.length ? [`${window.location.origin}/review.html?webhelpId=${webhelpId}&version=${currentVersion}&subFolder=${subFolder}&topic=${topic}`] : [];
            });
        });
        return Promise.all(elementLinkPromises).then(elementLinksArr => {
          const elementLevelLinks = elementLinksArr.flat();
          // Combine both arrays
          return topicLevelLinks.concat(elementLevelLinks);
        });
      })
      .then(allLinks => {
        if (allLinks.length === 0) {
          alert('No topics marked for review.');
          return;
        }
        // Remove duplicate links.
        const uniqueLinks = [...new Set(allLinks)];
        copyTextToClipboard(uniqueLinks.join('\n'))
        .then(() => alert('Links copied to clipboard!'))
        .catch(err => {
          console.error("Copy failed:", err);
          alert("Failed to copy links.");
        });
      })
      
      .catch(err => console.error("Error fetching review marks:", err));
  });

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
    if (!contextMenu.contains(event.target)) contextMenu.style.display = 'none';
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
    // Refresh review marks when the version changes.
  loadReviewMarks();
  });

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

      if (annotationType === "comment") menu.appendChild(editBtn);
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
        if (textElem) document.getElementById('editText').value = textElem.textContent;
        currentEditTarget = parentAnnotation;
        showModal('editModal');
        removeMenu();
      });

      deleteBtn.addEventListener("click", function() {
        let annotationObj = reviewItems.find(item => item.id === annotationId);
        if (!annotationObj) annotationObj = rebuildAnnotation(parentAnnotation);
        if (annotationObj) annotationObj.status = "deleted";
        parentAnnotation.remove();
        revertAnnotationText(annotationType, annotationId);
        annotationMap.delete(annotationId);
        reviewItems = reviewItems.filter(item => item.id !== annotationId);
        saveAnnotationToServer(annotationObj, currentTopic);
        removeMenu();
      });

      acceptBtn.addEventListener("click", function() {
        let annotationObj = reviewItems.find(item => item.id === annotationId);
        if (!annotationObj) annotationObj = rebuildAnnotation(parentAnnotation);
        if (annotationObj) {
          annotationObj.status = "accepted";
          addAnnotationStatusIcon(parentAnnotation, "accepted");
          saveAnnotationToServer(annotationObj, currentTopic);
        }
        removeMenu();
      });

      rejectBtn.addEventListener("click", function() {
        let annotationObj = reviewItems.find(item => item.id === annotationId);
        if (!annotationObj) annotationObj = rebuildAnnotation(parentAnnotation);
        if (annotationObj) {
          annotationObj.status = "rejected";
          addAnnotationStatusIcon(parentAnnotation, "rejected");
          saveAnnotationToServer(annotationObj, currentTopic);
        }
        removeMenu();
      });

      resolveBtn.addEventListener("click", function() {
        let annotationObj = reviewItems.find(item => item.id === annotationId);
        if (!annotationObj) annotationObj = rebuildAnnotation(parentAnnotation);
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
        if (menu.parentNode) menu.parentNode.removeChild(menu);
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

  socket.on('annotation-change', (data) => {
    if (data.id === socket.id) return;
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

        let replyAnnotation = reviewItems.find(item => item.id === replyItem.dataset.itemId);
        if (replyAnnotation) {
          replyAnnotation.text = newText;
          replyAnnotation.timestamp = new Date().toLocaleString();
        } else {
          replyAnnotation = {
            id: replyItem.dataset.itemId,
            type: replyItem.dataset.type,
            text: newText,
            user: currentUserAnnotation,
            timestamp: new Date().toLocaleString(),
            parentId: replyItem.closest('.review-item').dataset.itemId
          };
          reviewItems.push(replyAnnotation);
        }
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

  document.getElementById('submitEdit').addEventListener('click', () => {
    const newText = document.getElementById('editText').value.trim();
    if (newText && currentEditTarget) {
      const textElem = currentEditTarget.querySelector('.text');
      if (textElem) textElem.textContent = newText;
      let annotation = reviewItems.find(item => item.id === currentEditTarget.dataset.itemId);
      if (annotation) {
        annotation.text = newText;
        annotation.timestamp = new Date().toLocaleString();
      } else {
        console.warn("Annotation not found in reviewItems; rebuilding annotation object.");
        annotation = {
          id: currentEditTarget.dataset.itemId,
          type: currentEditTarget.dataset.type,
          text: newText,
          user: currentUserAnnotation,
          timestamp: new Date().toLocaleString(),
          range: currentEditTarget.dataset.range ? JSON.parse(currentEditTarget.dataset.range) : undefined
        };
        reviewItems.push(annotation);
      }
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
        if (textElem) document.getElementById('editText').value = textElem.textContent;
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
      if (marker) marker.classList.add("temp-highlight");
    }
  });

  document.getElementById('reviewList').addEventListener('mouseout', (e) => {
    const item = e.target.closest('.review-item');
    if (!item) return;
    const type = item.dataset.type;
    const id = item.dataset.itemId;
    if (type === 'deletion' || type === 'replacement' || type === 'highlight') {
      let marker = document.querySelector(`[data-deletion-id="${id}"]`) || document.querySelector(`[data-highlight-id="${id}"]`);
      if (marker) marker.classList.remove("temp-highlight");
    }
  });

  document.getElementById('commentButton').addEventListener('click', () => {
    showModal('speechBubble');
  });

  document.getElementById('replaceButton').addEventListener('click', () => {
    document.getElementById('replaceFrom').value = selectedText;
    showModal('replaceModal');
  });

  const markTextBtn = document.getElementById('markTextForReviewButton');
if (markTextBtn) {
  markTextBtn.addEventListener('click', () => {
    if (selectedRange && !selectedRange.collapsed) {
      try {
        // Clone the range and serialize it BEFORE modifying the DOM
        const clonedRange = selectedRange.cloneRange();
        const serialized = advancedSerializeRange(clonedRange);

        // Now wrap the selected content in a <span>
        const span = document.createElement('span');
        span.classList.add('marked-for-review');
        span.appendChild(clonedRange.extractContents());
        clonedRange.insertNode(span);

        markCurrentTopicAsNeedsReview();

        // Build and persist the review mark object using the serialized data
        const reviewMark = {
          id: Date.now().toString(), // unique ID
          type: 'review-mark-text',
          user: currentUserAnnotation,
          timestamp: new Date().toISOString(),
          range: serialized,  // use the serialized data captured before DOM manipulation
          webhelpId: webhelpId,
          version: currentVersion,
          topic: currentTopic
        };
        saveReviewMark(reviewMark);
      } catch (err) {
        console.error("Error while marking text for review:", err);
      } finally {
        contextMenu.style.display = 'none';
      }
    }
  });
}



const markElementBtn = document.getElementById('markElementForReviewButton');
if (markElementBtn) {
  markElementBtn.addEventListener('click', () => {
    try {
      const sel = window.getSelection();
      if (!sel || !sel.anchorNode) return;
      const baseElem = (sel.anchorNode.nodeType === Node.TEXT_NODE)
                         ? sel.anchorNode.parentElement
                         : sel.anchorNode;
      // Choose the nearest block element (adjust selector as needed)
      const blockElem = baseElem.closest('p, h1, h2, h3, li, div, blockquote, section, table, td');
      if (blockElem) {
        blockElem.classList.add('marked-for-review');
        markCurrentTopicAsNeedsReview();

        // Use an XPath to later reapply the mark.
        // Assume getXPathForNode is available from review-lib.js.
        const xpath = getXPathForNode(blockElem, document.getElementById("topicContent"));

        const reviewMark = {
          id: Date.now().toString(),
          type: 'review-mark-element',
          user: currentUserAnnotation,
          timestamp: new Date().toISOString(),
          xpath: xpath,  // store location relative to topicContent
          webhelpId: webhelpId,
          version: currentVersion,
          topic: currentTopic
        };
        saveReviewMark(reviewMark);
      }
    } catch (err) {
      console.error("Error while marking element for review:", err);
    } finally {
      contextMenu.style.display = 'none';
    }
  });
}


// Toggle pink highlights for ".marked-for-review"
const toggleBtn = document.getElementById('toggleReviewHighlightsBtn');
if (toggleBtn) {
  toggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('hide-review-highlights');
    const isHidden = document.body.classList.contains('hide-review-highlights');
    toggleBtn.textContent = isHidden ? 'Show Review Highlights' : 'Hide Review Highlights';
  });
}



  
});