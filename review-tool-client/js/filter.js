// Function to open the filter modal
function openFilterModal() {
    document.getElementById("filterModal").style.display = "block";

    // Populate version select in the modal with the current view version
    const currentViewVersion = document.getElementById("versionSelect").value;
    const versionSelectModal = document.getElementById("versionSelectModal");
    versionSelectModal.innerHTML = ""; // Clear existing options

    // Assuming populateVersions is a function similar to what loads versions normally
    populateVersions(versionSelectModal, currentViewVersion);

    // Fetch users and populate user list based on the current topic and version
    const topic = localStorage.getItem("currentTopic");
    const version = versionSelectModal.value; // or use a specific logic to decide version
    fetchUsersForVersion(topic, version);
}

// Function to close the filter modal
function closeFilterModal() {
    document.getElementById("filterModal").style.display = "none";
}

// Populate users list in the filter modal
function fetchUsersForVersion(topic, version) {
    const url = `/getReviewChanges/${webhelpId}/${version}/${encodeURIComponent(topic)}`;
    fetch(url)
        .then(response => response.json())
        .then(flatAnnotations => {
            const userSet = new Set(flatAnnotations.map(a => a.userName));
            const userList = document.getElementById("userList");
            userList.innerHTML = ""; // Clear previous user list
            userSet.forEach(user => {
                const listItem = document.createElement("li");
                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.id = `user_${user}`;
                checkbox.name = "user";
                checkbox.value = user;

                const label = document.createElement("label");
                label.htmlFor = `user_${user}`;
                label.textContent = user;

                listItem.appendChild(checkbox);
                listItem.appendChild(label);
                userList.appendChild(listItem);
            });
        })
        .catch(error => {
            console.error("Error fetching users for annotations:", error);
        });
}

// Function to populate version options into the modal
function populateVersions(selectElement, currentSelection) {
    const currentVersionNum = parseInt(currentSelection.substring(1)) || 1;
    for (let i = 1; i <= currentVersionNum; i++) {
        const opt = document.createElement("option");
        opt.value = "v" + i;
        opt.textContent = "v" + i;
        selectElement.appendChild(opt);
    }
    if (currentVersionNum > 1) {
        const allOpt = document.createElement("option");
        allOpt.value = "all";
        allOpt.textContent = "All Versions";
        selectElement.appendChild(allOpt);
    }
    selectElement.value = currentSelection;
}

// Function to apply selected filters
function applyFilters() {
    const filterUserNameList = Array.from(document.querySelectorAll('input[name="user"]:checked')).map(el => el.value);
    const filterStatusList = Array.from(document.querySelectorAll('input[name="status"]:checked')).map(el => el.value);
    const filterTypeList = Array.from(document.querySelectorAll('input[name="type"]:checked')).map(el => el.value);
    const selectedVersion = document.getElementById("versionSelectModal").value;

    loadAnnotationsFromServer(localStorage.getItem("currentTopic"), false, selectedVersion, {
        userName: filterUserNameList,
        status: filterStatusList,
        type: filterTypeList
    });

    closeFilterModal();
}

// Set up event listeners
document.getElementById("filterButton").addEventListener("click", openFilterModal);
