/* updated loadAnnotationsFromServer function with filtering options */
function loadAnnotationsFromServer(topic, includePrevious = false, baseVersion = null, filterParams = {}) {
    if (!topic) topic = "default";
    currentTopic = topic;
    localStorage.setItem("currentTopic", currentTopic);
    let versionToUse = baseVersion ? baseVersion : version;
    let url = `/getReviewChanges/${webhelpId}/${versionToUse}/${encodeURIComponent(topic)}`;
    if (includePrevious) {
        url += '?includePrevious=true';
    }

    fetch(url)
        .then(response => response.json())
        .then(flatAnnotations => {
            const applyFilters = annotation => {
                for (let [key, value] of Object.entries(filterParams)) {
                    if (annotation[key] !== value) {
                        return false;
                    }
                }
                return true;
            };

            const annotationsMap = {};
            flatAnnotations.forEach(a => {
                annotationsMap[a.id] = a;
                a.replies = [];
            });
            const topAnnotations = [];
            flatAnnotations.forEach(a => {
                // Dynamic filtering based on the filterParams object
                if (!applyFilters(a)) {
                    return;
                }

                if (a.parentId) {
                    if (annotationsMap[a.parentId]) {
                        annotationsMap[a.parentId].replies.push(a);
                    }
                } else {
                    topAnnotations.push(a);
                }
            });

            const reviewList = document.getElementById("reviewList");
            reviewList.innerHTML = "";
            reviewItems = [];
            topAnnotations.forEach(a => {
                // Skip rendering if annotation is marked deleted or resolved
                if (a.status === "deleted" || a.status === "resolved") {
                    return;
                }

                const item = createReviewItem(a.type, a);
                if (a.type === 'comment' && a.range) {
                    reapplyCommentMarker(a);
                } else if (a.type === 'deletion' && a.range) {
                    reapplyDeletionMarker(a);
                } else if (a.type === 'highlight' && a.range) {
                    reapplyHighlightMarker(a);
                } else if (a.type === 'replacement' && a.range) {
                    reapplyReplacementMarker(a);
                }

                // If status is accepted or rejected, add status icon
                if (a.status === "accepted") {
                    addAnnotationStatusIcon(item, "accepted");
                } else if (a.status === "rejected") {
                    addAnnotationStatusIcon(item, "rejected");
                }

                if (a.replies && a.replies.length > 0) {
                    const replyContainer = item.querySelector('.reply-container');
                    if (replyContainer) {
                        a.replies.forEach(reply => {
                            // Apply dynamic filtering to replies
                            if (!applyFilters(reply) || reply.status === "deleted" || reply.status === "resolved") {
                                return;
                            }
                            const replyItem = createReplyItem(reply);
                            replyContainer.appendChild(replyItem);
                            reviewItems.push(reply);
                        });
                        paginateReplies(replyContainer);
                    }
                }

                reviewList.appendChild(item);
                reviewItems.push(a);
            });
        })
        .catch(error => {
            console.error("Error loading annotations from server:", error);
        });
}
