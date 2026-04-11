const API_URL = 'https://lvs-streem-backend.onrender.com/api/channels';

// DOM Elements
const channelForm = document.getElementById('channel-form');
const channelsList = document.getElementById('channels-list');
const formTitle = document.getElementById('form-title');
const submitBtn = document.getElementById('submit-btn');
const cancelBtn = document.getElementById('cancel-btn');
const loadingIndicator = document.getElementById('loading');
const errorMessage = document.getElementById('error-message');

// Form inputs
const idInput = document.getElementById('channel-id');
const nameInput = document.getElementById('name');
const iconInput = document.getElementById('icon');
const urlInput = document.getElementById('url');
const categoryInput = document.getElementById('category');

// State
let isEditing = false;
let currentChannels = [];

// Initialize and fetch channels
document.addEventListener('DOMContentLoaded', fetchChannels);

// Event Listeners
channelForm.addEventListener('submit', handleFormSubmit);
cancelBtn.addEventListener('click', resetForm);

// Fetch all channels from API
async function fetchChannels() {
    showLoading(true);
    hideError();
    
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error('Failed to fetch channels');
        
        currentChannels = await response.json();
        renderChannels(currentChannels);
    } catch (error) {
        showError(error.message);
    } finally {
        showLoading(false);
    }
}

// Render channels to table
function renderChannels(channels) {
    channelsList.innerHTML = '';
    
    if (channels.length === 0) {
        channelsList.innerHTML = '<tr><td colspan="5" class="loading">No channels found. Add one above.</td></tr>';
        return;
    }
    
    channels.forEach(channel => {
        const tr = document.createElement('tr');
        
        // Handle images that might fail to load
        const iconHtml = channel.icon 
            ? `<img src="${channel.icon}" alt="${channel.name}" class="channel-img" onerror="this.src='https://via.placeholder.com/50?text=Logo'">` 
            : 'No image';
            
        tr.innerHTML = `
            <td>${iconHtml}</td>
            <td><strong>${channel.name}</strong></td>
            <td><span style="background:#e0e0e0; padding:2px 8px; border-radius:10px; font-size:0.85em;">${channel.category}</span></td>
            <td class="url-cell" title="${channel.url}">${channel.url}</td>
            <td>
                <label class="switch">
                    <input type="checkbox" onchange="toggleChannelVisibility('${channel._id}', this.checked)" ${channel.isActive !== false ? 'checked' : ''}>
                    <span class="slider round"></span>
                </label>
            </td>
            <td>
                <button class="edit-btn" onclick="editChannel('${channel._id}')">Edit</button>
                <button class="delete-btn" onclick="deleteChannel('${channel._id}')">Delete</button>
            </td>
        `;
        
        channelsList.appendChild(tr);
    });
}

// Handle form submission (Add or Update)
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const channelData = {
        name: nameInput.value.trim(),
        icon: iconInput.value.trim(),
        url: urlInput.value.trim(),
        category: categoryInput.value.trim()
    };
    
    try {
        if (isEditing) {
            // Update existing channel
            const id = idInput.value;
            const response = await fetch(`${API_URL}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(channelData)
            });
            
            if (!response.ok) throw new Error('Failed to update channel');
        } else {
            // Add new channel
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(channelData)
            });
            
            if (!response.ok) throw new Error('Failed to add channel');
        }
        
        resetForm();
        fetchChannels();
        
    } catch (error) {
        showError(error.message);
    }
}

// Populate form for editing
function editChannel(id) {
    const channel = currentChannels.find(c => c._id === id);
    if (!channel) return;
    
    idInput.value = channel._id;
    nameInput.value = channel.name;
    iconInput.value = channel.icon;
    urlInput.value = channel.url;
    categoryInput.value = channel.category;
    
    isEditing = true;
    formTitle.textContent = 'Edit Channel';
    submitBtn.textContent = 'Update Channel';
    cancelBtn.style.display = 'inline-block';
    
    // Scroll to form
    document.querySelector('.form-section').scrollIntoView({ behavior: 'smooth' });
}

// Delete a channel
async function deleteChannel(id) {
    if (!confirm('Are you sure you want to delete this channel?')) return;
    
    try {
        const response = await fetch(`${API_URL}/${id}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Failed to delete channel');
        
        // Remove from local array and re-render to avoid extra network request if desired
        currentChannels = currentChannels.filter(c => c._id !== id);
        renderChannels(currentChannels);
        
    } catch (error) {
        showError(error.message);
    }
}

// Toggle Channel Visibility
async function toggleChannelVisibility(id, isActive) {
    try {
        const response = await fetch(`${API_URL}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive })
        });
        
        if (!response.ok) throw new Error('Failed to update visibility');
        
        // Update local state without full reload
        const channelIndex = currentChannels.findIndex(c => c._id === id);
        if (channelIndex > -1) {
            currentChannels[channelIndex].isActive = isActive;
        }
        
    } catch (error) {
        showError(error.message);
        // Revert UI toggle visually if request fails
        fetchChannels();
    }
}

// Reset the form
function resetForm() {
    channelForm.reset();
    idInput.value = '';
    isEditing = false;
    formTitle.textContent = 'Add New Channel';
    submitBtn.textContent = 'Save Channel';
    cancelBtn.style.display = 'none';
}

// UI Helpers
function showLoading(show) {
    loadingIndicator.style.display = show ? 'block' : 'none';
    if (show) channelsList.innerHTML = '';
}

function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.style.display = 'block';
    setTimeout(hideError, 5000);
}

function hideError() {
    errorMessage.style.display = 'none';
}
