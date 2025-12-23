import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, onValue, set, get, remove, update, runTransaction } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyB5jaPVkCwxXiMYhSn0uuW9QSMc-B5C9YY",
    authDomain: "mjsmartapps.firebaseapp.com",
    databaseURL: "https://mjsmartapps-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "mjsmartapps",
    storageBucket: "mjsmartapps.firebasestorage.app",
    messagingSenderId: "1033240518010",
    appId: "1:1033240518010:web:930921011dda1bd56e0ac3",
    measurementId: "G-959VLQSHH2"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

function formatBytes(bytes) {
    if (!+bytes) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(2))} ${sizes[i]}`;
}

let activeAddClientId, activeAddClientName, editClientModalInstance, addMoreModalInstance, deleteConfirmModalInstance, lockedModalInstance, addClientModalInstance;
let pendingDeleteId = null;
let isCreationLocked = false; 
window.allClientsData = [];

let currentGalleryId = null;
let currentDeleteRequests = [];
let isDeleteFilterActive = false;
let currentPhotosCache = [];
let displayedPhotos = []; 
let currentLightboxIndex = 0;

function generateCleanId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let autoId = '';
    for (let i = 0; i < 20; i++) {
        autoId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return autoId;
}

document.addEventListener('DOMContentLoaded', () => {
        editClientModalInstance = new bootstrap.Modal(document.getElementById('editClientModal'));
        addMoreModalInstance = new bootstrap.Modal(document.getElementById('addMorePhotosModal'));
        deleteConfirmModalInstance = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
        lockedModalInstance = new bootstrap.Modal(document.getElementById('lockedModal'));
        addClientModalInstance = new bootstrap.Modal(document.getElementById('addClientModal')); 
        
        document.getElementById('addMoreInput').addEventListener('change', function(){
            document.getElementById('addMoreCountLabel').innerText = this.files.length ? `${this.files.length} files selected` : '';
            document.getElementById('btnAddMoreConfirm').disabled = !this.files.length;
        });

        const now = new Date();
        const monthStr = now.toISOString().slice(0, 7); 
        document.getElementById('storageMonthFilter').value = monthStr;

        document.getElementById('storageSearch').addEventListener('input', filterAndRenderStorage);
        document.getElementById('storageMonthFilter').addEventListener('change', filterAndRenderStorage);

        document.getElementById('clientSearchInput').addEventListener('input', renderClientTable);
        document.getElementById('clientMonthFilter').addEventListener('change', renderClientTable);

        document.getElementById('addClientModal').addEventListener('shown.bs.modal', () => {
            document.getElementById('clientDate').valueAsDate = new Date();
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
            const overlay = document.getElementById('mediaLightbox');
            if(overlay.style.display === 'flex') closeLightbox({target: overlay});
            }
            if (document.getElementById('mediaLightbox').style.display === 'flex') {
            if (e.key === 'ArrowLeft') changeSlide(-1);
            if (e.key === 'ArrowRight') changeSlide(1);
            }
        });
});

window.showToast = (message, type = 'info') => {
    const toastContainer = document.getElementById('toastContainer');
    const toastEl = document.createElement('div');
    let headerClass = type === 'success' ? 'bg-success text-white' : type === 'error' ? 'bg-danger text-white' : 'bg-primary text-white';
    const toastHtml = `<div class="toast show"><div class="toast-header ${headerClass}"><strong class="me-auto">Notification</strong><button type="button" class="btn-close btn-close-white" onclick="this.parentElement.parentElement.remove()"></button></div><div class="toast-body text-white">${message}</div></div>`;
    toastEl.innerHTML = toastHtml;
    toastContainer.appendChild(toastEl.firstChild);
    setTimeout(() => toastContainer.lastChild?.remove(), 3000);
};

window.toggleSidebar = () => {
    document.querySelector('.sidebar').classList.toggle('active');
    document.querySelector('.sidebar-overlay').classList.toggle('active');
};

window.switchView = (v) => {
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    const navLink = document.getElementById(`nav-${v}`);
    if (navLink) navLink.classList.add('active');

    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${v}`).classList.add('active');
};

window.openNewClientModal = () => {
    if (isCreationLocked) {
        document.getElementById('lockedModalHeader').innerText = "Creation Suspended";
        document.getElementById('lockedModalText').innerHTML = 
            `New client creation is currently disabled by the developer.
            <br><br>
            <span class="text-white bg-danger bg-opacity-25 px-3 py-1 rounded">Please contact support for access.</span>`;
        lockedModalInstance.show();
    } else {
        addClientModalInstance.show();
    }
};

window.checkLock = (isLocked) => {
    if (isLocked) {
        document.getElementById('lockedModalHeader').innerText = "Service Suspended";
        document.getElementById('lockedModalText').innerHTML = 
            `This action is disabled because the month has been locked by the developer.
            <br><br>
            <span class="text-white bg-danger bg-opacity-25 px-3 py-1 rounded">Please contact your developer or Pay Month due.</span>`;
        
        lockedModalInstance.show();
        return true; 
    }
    return false;
};

window.downloadGalleryZip = async () => {
    if (!currentPhotosCache || currentPhotosCache.length === 0) {
        showToast("No photos to download.", "warning");
        return;
    }

    const btn = document.getElementById('btnDownloadZip');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Zipping...';

    try {
        const zip = new JSZip();
        const folder = zip.folder("rathnastudio");
        const existingNames = new Set();
        
        const promises = currentPhotosCache.map(async (photo) => {
            try {
                const response = await fetch(photo.url);
                const blob = await response.blob();
                
                let rawName = photo.url.split('/').pop().split('?')[0];
                rawName = decodeURIComponent(rawName);
                
                let parts = rawName.split('.');
                let ext = parts.length > 1 ? parts.pop() : 'bin';
                let name = parts.join('.');
                
                name = name.replace(/[^a-zA-Z0-9-]/g, '');
                ext = ext.replace(/[^a-zA-Z0-9]/g, '');
                
                let cleanName = `${name}.${ext}`;
                
                let finalName = cleanName;
                let counter = 1;
                while (existingNames.has(finalName)) {
                    finalName = `${name}-${counter}.${ext}`;
                    counter++;
                }
                existingNames.add(finalName);
                
                folder.file(finalName, blob);
            } catch (err) {
                console.error("Failed to load", photo.url);
            }
        });

        await Promise.all(promises);
        
        const content = await zip.generateAsync({type: "blob"});
        const zipName = `Gallery-${currentGalleryId}.zip`;
        saveAs(content, zipName);
        showToast("ZIP Downloaded Successfully!", "success");
    } catch (e) {
        showToast("Error creating ZIP.", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

window.openLightbox = (index) => {
    if (index < 0 || index >= displayedPhotos.length) return;
    
    currentLightboxIndex = index;
    const item = displayedPhotos[index]; 
    const url = item.url;
    
    const isVideo = item.type ? item.type.startsWith('video') : (url.match(/\.(mp4|webm|ogg|mov|m4v)$/i) !== null);

    const container = document.getElementById('lightboxContainer');
    const overlay = document.getElementById('mediaLightbox');
    
    container.innerHTML = '';
    
    if (isVideo) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        video.className = 'lightbox-content';
        video.muted = false; 
        video.playsInline = true;
        video.preload = "auto";
        
        video.onerror = (e) => {
            console.error("Video failed to load:", url);
            video.style.display = 'none'; 
            const errorBox = document.createElement('div');
            errorBox.className = "text-center p-4 bg-dark border border-secondary border-opacity-25 rounded";
            errorBox.innerHTML = `
                <i class="bi bi-file-earmark-play-fill text-danger display-1"></i>
                <h4 class="mt-3">Playback Error</h4>
                <p class="text-secondary small mb-3">Format not supported or link restricted.</p>
                <a href="${url}" target="_blank" class="btn btn-primary btn-sm">
                    <i class="bi bi-box-arrow-up-right me-2"></i>Open Video in New Tab
                </a>
            `;
            container.appendChild(errorBox);
        };
        container.appendChild(video);
    } else {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'lightbox-content';
        container.appendChild(img);
    }
    
    overlay.style.display = 'flex';
};

window.changeSlide = (step) => {
    let newIndex = currentLightboxIndex + step;
    if (newIndex < 0) newIndex = displayedPhotos.length - 1;
    if (newIndex >= displayedPhotos.length) newIndex = 0;
    
    const container = document.getElementById('lightboxContainer');
    const video = container.querySelector('video');
    if (video) video.pause();

    openLightbox(newIndex);
};

window.closeLightbox = (e) => {
    if (e.target.id === 'mediaLightbox' || e.target.classList.contains('lightbox-close') || e.target.id === 'lightboxContainer') {
        const overlay = document.getElementById('mediaLightbox');
        const container = document.getElementById('lightboxContainer');
        
        const video = container.querySelector('video');
        if (video) {
            video.pause();
            video.src = ""; 
        }
        
        overlay.style.display = 'none';
        container.innerHTML = '';
    }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('loginView').classList.add('hidden');
        document.getElementById('dashboardView').classList.remove('hidden');
        initClientsListener();
        initSettingsListener(); 
    } else {
        document.getElementById('dashboardView').classList.add('hidden');
        document.getElementById('loginView').classList.remove('hidden');
    }
});

document.getElementById('btnLogin').addEventListener('click', () => {
    signInWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passInput').value)
        .catch(err => showToast(err.message, 'error'));
});
document.getElementById('btnLogout').addEventListener('click', () => signOut(auth));

Promise.all([
    faceapi.nets.ssdMobilenetv1.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models')
]).then(() => document.getElementById('dashboardModelStatus').innerHTML = '<span class="text-success">Active</span>');

function initSettingsListener() {
    onValue(ref(db, 'settings/creationLocked'), (snapshot) => {
        isCreationLocked = snapshot.val() === true;
    });
}

function initClientsListener() {
    onValue(ref(db, 'clients'), (snapshot) => {
        window.allClientsData = []; 
        if (snapshot.exists()) {
            const data = snapshot.val();
            document.getElementById('totalClientsCount').innerText = Object.keys(data).length;

            const clientsArray = Object.entries(data).map(([key, val]) => ({key, ...val}));
            clientsArray.sort((a, b) => new Date(b.date) - new Date(a.date));

            clientsArray.forEach(clientObj => {
                window.allClientsData.push({...clientObj, id: clientObj.key}); 
            });
        } else {
            document.getElementById('totalClientsCount').innerText = 0;
        }
        
        let globalTotalSize = 0;
        const monthlyGroups = {};

        window.allClientsData.forEach(client => {
            const size = client.totalSize || 0;
            const cost = (size / (1024 ** 3)) * 15;
            globalTotalSize += size;

            const date = new Date(client.date);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            if (!monthlyGroups[monthKey]) {
                monthlyGroups[monthKey] = {
                    totalCost: 0,
                    paidAmount: 0,
                    isPaidStatus: false
                };
            }

            monthlyGroups[monthKey].totalCost += cost;

            if (client.paymentStatus === 'paid') {
                monthlyGroups[monthKey].isPaidStatus = true;
                if (client.paymentMeta && client.paymentMeta.batchPaidAmount) {
                    monthlyGroups[monthKey].paidAmount = parseFloat(client.paymentMeta.batchPaidAmount);
                } else {
                    monthlyGroups[monthKey].paidAmount = -1; 
                }
            }
        });

        let globalPendingPayment = 0;
        Object.values(monthlyGroups).forEach(month => {
            if (month.isPaidStatus) {
                if (month.paidAmount === -1) {
                    globalPendingPayment += 0;
                } else {
                    const pending = Math.max(0, month.totalCost - month.paidAmount);
                    globalPendingPayment += pending;
                }
            } else {
                globalPendingPayment += month.totalCost;
            }
        });

        document.getElementById('totalStorageUsed').innerText = formatBytes(globalTotalSize);
        document.getElementById('dashboardPendingPayment').innerText = `₹${globalPendingPayment.toFixed(2)}`;
        
        renderClientTable();
        filterAndRenderStorage(); 
    });
}

window.renderClientTable = () => {
    const tbody = document.getElementById('clientsTableBody');
    tbody.innerHTML = '';
    
    const searchTerm = document.getElementById('clientSearchInput').value.toLowerCase();
    const monthFilter = document.getElementById('clientMonthFilter').value; 
    
    const filteredClients = window.allClientsData.filter(client => {
        const nameMatch = client.name.toLowerCase().includes(searchTerm);
        const phoneMatch = client.phone.includes(searchTerm);
        const matchesSearch = nameMatch || phoneMatch;
        const matchesMonth = monthFilter ? client.date.startsWith(monthFilter) : true;
        return matchesSearch && matchesMonth;
    });

    if (filteredClients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-secondary py-5">No matching clients found.</td></tr>';
            return;
    }

    filteredClients.forEach(client => {
        const key = client.id;
        const baseUrl = window.location.href.replace('admin.html', 'index.html').split('#')[0];
        
        const isLocked = client.isLocked === true;
        const rowClass = isLocked ? 'row-locked' : '';
        const lockBadge = isLocked ? '<span class="locked-badge">LOCKED</span>' : '';

        const isAiActive = client.linkStatus?.ai !== false;
        const isGalActive = client.linkStatus?.gallery !== false;
        const isDelActive = client.linkStatus?.delete !== false;

        const tr = document.createElement('tr');
        tr.className = rowClass;
        tr.innerHTML = `
            <td><span class="text-white">${client.date}</span></td>
            <td><span class="fw-bold text-white">${client.name}</span>${lockBadge}</td>
            <td>${client.eventName}</td>
            <td>${client.phone}</td>
            <td class="text-center"><span class="badge bg-secondary bg-opacity-25 text-light">${client.totalImages || 0}</span></td>
            <td class="font-monospace text-accent small">${formatBytes(client.totalSize || 0)}</td>
            <td>
                <div class="d-flex gap-1">
                    <button class="btn-icon view" onclick="if(!checkLock(${isLocked})) viewClientGallery('${key}')"><i class="bi bi-eye"></i></button>
                    <button class="btn-icon add ${isLocked?'disabled':''}" onclick="if(!checkLock(${isLocked})) triggerAddMore('${key}', '${client.name}')"><i class="bi bi-cloud-plus"></i></button>
                    <button class="btn-icon edit ${isLocked?'disabled':''}" onclick="if(!checkLock(${isLocked})) triggerEdit('${key}')"><i class="bi bi-pencil"></i></button>
                </div>
            </td>
            <td>
                <div class="d-flex flex-column gap-1">
                    <div class="d-flex align-items-center gap-2">
                        <div class="form-check form-switch m-0" title="Enable/Disable Link">
                            <input class="form-check-input" type="checkbox" role="switch" 
                                ${isAiActive ? 'checked' : ''} 
                                onchange="toggleLinkStatus('${key}', 'ai', this.checked)">
                        </div>
                        <button class="btn btn-sm btn-outline-primary flex-grow-1 text-start py-0 px-2" style="height: 24px; font-size: 0.8rem;"
                            onclick="if(!checkLock(${isLocked})) copyToClipboard('${baseUrl}?eventId=${key}')">
                            <i class="bi bi-robot me-1"></i>AI
                        </button>
                    </div>
                    <div class="d-flex align-items-center gap-2">
                        <div class="form-check form-switch m-0" title="Enable/Disable Link">
                            <input class="form-check-input" type="checkbox" role="switch" 
                                ${isGalActive ? 'checked' : ''} 
                                onchange="toggleLinkStatus('${key}', 'gallery', this.checked)">
                        </div>
                        <button class="btn btn-sm btn-outline-info flex-grow-1 text-start py-0 px-2" style="height: 24px; font-size: 0.8rem;"
                            onclick="if(!checkLock(${isLocked})) copyToClipboard('${baseUrl}?eventId=${key}&view=all')">
                            <i class="bi bi-grid me-1"></i>Gallery
                        </button>
                    </div>
                        <div class="d-flex align-items-center gap-2">
                        <div class="form-check form-switch m-0" title="Enable/Disable Link">
                            <input class="form-check-input" type="checkbox" role="switch" 
                                ${isDelActive ? 'checked' : ''} 
                                onchange="toggleLinkStatus('${key}', 'delete', this.checked)">
                        </div>
                        <button class="btn btn-sm btn-outline-danger flex-grow-1 text-start py-0 px-2" style="height: 24px; font-size: 0.8rem;"
                            onclick="if(!checkLock(${isLocked})) copyToClipboard('${baseUrl}?eventId=${key}&view=delete')">
                            <i class="bi bi-trash-fill me-1"></i>Del. Link
                        </button>
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
};

window.toggleLinkStatus = async (clientId, type, status) => {
    try {
        await update(ref(db, `clients/${clientId}/linkStatus`), {
            [type]: status
        });
    } catch (e) {
        showToast("Error updating link status", "error");
    }
};

window.filterAndRenderStorage = () => {
    const searchTerm = document.getElementById('storageSearch').value.toLowerCase();
    const monthFilter = document.getElementById('storageMonthFilter').value; 
    const tbody = document.getElementById('storageHistoryBody');
    tbody.innerHTML = '';

    const filteredClients = window.allClientsData.filter(client => {
        const matchesSearch = (client.name.toLowerCase().includes(searchTerm) || client.eventName.toLowerCase().includes(searchTerm));
        const matchesMonth = monthFilter ? client.date.startsWith(monthFilter) : true;
        return matchesSearch && matchesMonth;
    });

    if(filteredClients.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No events found for this filter.</td></tr>';
        document.getElementById('storageViewTotalSize').innerText = "0 MB";
        document.getElementById('storageViewTotalFiles').innerText = "0";
        document.getElementById('storageViewTotalViews').innerText = "0";
        document.getElementById('storageViewTotalDownloads').innerText = "0";
        document.getElementById('storageViewTotalCost').innerText = "₹0.00";
        document.getElementById('storageViewPendingCost').innerText = "₹0.00";
        return;
    }

    let totalSize = 0;
    let totalFiles = 0;
    let totalViews = 0;
    let totalDownloads = 0;
    let pendingCost = 0;

    const monthlyGroups = {};

    filteredClients.forEach(c => {
        const size = c.totalSize || 0;
        const cost = (size / (1024 ** 3)) * 15;
        
        totalSize += size;
        totalFiles += (c.totalImages || 0);
        totalViews += (c.totalViews || 0);
        totalDownloads += (c.totalDownloads || 0);

        const date = new Date(c.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthlyGroups[monthKey]) {
            monthlyGroups[monthKey] = { totalCost: 0, paidAmount: 0, isPaidStatus: false };
        }
        monthlyGroups[monthKey].totalCost += cost;

        if (c.paymentStatus === 'paid') {
            monthlyGroups[monthKey].isPaidStatus = true;
            if (c.paymentMeta && c.paymentMeta.batchPaidAmount) {
                monthlyGroups[monthKey].paidAmount = parseFloat(c.paymentMeta.batchPaidAmount);
            } else {
                monthlyGroups[monthKey].paidAmount = -1; 
            }
        }
    });

    Object.values(monthlyGroups).forEach(month => {
        if (month.isPaidStatus) {
            if (month.paidAmount === -1) {
                pendingCost += 0;
            } else {
                pendingCost += Math.max(0, month.totalCost - month.paidAmount);
            }
        } else {
            pendingCost += month.totalCost;
        }
    });

    document.getElementById('storageViewTotalSize').innerText = formatBytes(totalSize);
    document.getElementById('storageViewTotalFiles').innerText = totalFiles;
    document.getElementById('storageViewTotalViews').innerText = totalViews;
    document.getElementById('storageViewTotalDownloads').innerText = totalDownloads;
    
    const totalCost = (totalSize / (1024 ** 3)) * 15;
    document.getElementById('storageViewTotalCost').innerText = `₹${totalCost.toFixed(2)}`;
    document.getElementById('storageViewPendingCost').innerText = `₹${pendingCost.toFixed(2)}`;

    filteredClients.sort((a, b) => new Date(b.date) - new Date(a.date));

    filteredClients.forEach(client => {
        const size = client.totalSize || 0;
        const cost = (size / (1024 ** 3)) * 15;
        
        let balanceText = `₹${cost.toFixed(2)}`;
        let balanceClass = "text-danger";

        if (client.paymentStatus === 'paid') {
            if (client.paymentMeta && client.paymentMeta.batchPaidAmount) {
                const date = new Date(client.date);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const monthGroup = monthlyGroups[monthKey];
                
                const isMonthDeficit = (monthGroup.totalCost - monthGroup.paidAmount) > 0.01;

                if (isMonthDeficit) {
                    balanceClass = "text-danger"; 
                } else {
                    balanceClass = "text-success"; 
                }
            } else {
                balanceClass = "text-success"; 
            }
        } else {
            balanceClass = "text-danger"; 
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="fw-bold text-white">${client.eventName}</td>
            <td>${client.name}</td>
            <td><small class="text-secondary">${client.date}</small></td>
            <td><span class="badge bg-dark border border-secondary text-secondary">${client.totalImages || 0}</span></td>
            <td><span class="text-success">${client.totalViews || 0}</span></td>
            <td><span class="text-warning">${client.totalDownloads || 0}</span></td>
            <td class="font-monospace text-accent small">${formatBytes(size)}</td>
            <td class="font-monospace ${balanceClass} small fw-bold">${balanceText}</td>
        `;
        tbody.appendChild(tr);
    });
};

async function uploadToR2(file, clientId, index) {
    const ext = file.name.split('.').pop();
    const finalFileName = `${Date.now()}-${index}.${ext}`;
    const path = `rathnastudio/${clientId}/${finalFileName}`;
    
    const formData = new FormData();
    formData.append("file", file);
    formData.append("path", path);
    const WORKER_URL = "https://cool-rice-5599.mjappkdl.workers.dev"; 
    
    try {
        const res = await fetch(WORKER_URL, { method: "POST", body: formData });
        if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
        const data = await res.json();
        return data.url;
    } catch (error) {
        console.error("R2 Upload Error:", error);
        throw error;
    }
}

async function processAndUploadFiles(files, clientId) {
    const listContainer = document.getElementById('uploadFileList');
    const globalPercentLabel = document.getElementById('globalUploadPercent');
    
    // Create UI elements for each file
    const fileArray = Array.from(files);
    const uiMap = new Map();
    
    listContainer.innerHTML = '';
    
    fileArray.forEach((file, idx) => {
        const id = `file-upload-${idx}`;
        const itemHtml = `
            <div class="upload-file-item" id="${id}">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="text-white small text-truncate" style="max-width: 70%;">${file.name}</span>
                    <span class="text-secondary small speed-label" style="font-size: 0.75rem;">Waiting...</span>
                </div>
                <div class="progress sm">
                    <div class="progress-bar bg-secondary" role="progressbar" style="width: 0%"></div>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', itemHtml);
        uiMap.set(file, document.getElementById(id));
    });

    let completedCount = 0;
    const totalFiles = fileArray.length;

    // Helper to process one file
    const uploadSingle = async (file, index) => {
        const uiRow = uiMap.get(file);
        const bar = uiRow.querySelector('.progress-bar');
        const speedLabel = uiRow.querySelector('.speed-label');
        
        bar.classList.remove('bg-secondary');
        bar.classList.add('bg-accent', 'progress-bar-striped', 'progress-bar-animated');
        speedLabel.innerText = "Processing...";
        bar.style.width = '30%'; // Visual fake start

        try {
            const startTime = Date.now();
            let descriptors = [];
            
            // Step 1: Face Detection (Heavy, keep logic simple)
            if (file.type.startsWith('image/')) {
                speedLabel.innerText = "Scanning faces...";
                try {
                    const img = await faceapi.bufferToImage(file);
                    const detections = await faceapi.detectAllFaces(img).withFaceLandmarks().withFaceDescriptors();
                    descriptors = detections.length > 0 ? detections.map(d => Array.from(d.descriptor)) : [];
                } catch (e) {
                    console.warn('Face detection skipped:', e);
                }
            }
            
            bar.style.width = '60%';
            speedLabel.innerText = "Uploading...";

            // Step 2: R2 Upload
            const downloadURL = await uploadToR2(file, clientId, index);
            const photoId = generateCleanId();

            // Step 3: DB Save
            await set(ref(db, `rathnastudio/${clientId}/${photoId}`), {
                url: downloadURL,
                descriptors: descriptors,
                size: file.size,
                type: file.type, 
                uploadedAt: Date.now()
            });

            // Calc Speed
            const duration = (Date.now() - startTime) / 1000;
            const speed = (file.size / 1024 / 1024) / duration;
            
            bar.style.width = '100%';
            bar.classList.remove('progress-bar-striped', 'progress-bar-animated', 'bg-accent');
            bar.classList.add('bg-success');
            speedLabel.className = 'text-success small fw-bold';
            speedLabel.innerText = `Done (${speed.toFixed(1)} MB/s)`;

        } catch (err) {
            console.error(err);
            bar.classList.remove('bg-accent');
            bar.classList.add('bg-danger');
            speedLabel.className = 'text-danger small fw-bold';
            speedLabel.innerText = "Failed";
        } finally {
            completedCount++;
            const totalPercent = Math.round((completedCount / totalFiles) * 100);
            globalPercentLabel.innerText = `${totalPercent}%`;
        }
    };

    // BATCHING LOGIC (Concurrency = 3)
    const BATCH_SIZE = 3;
    for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
        const chunk = fileArray.slice(i, i + BATCH_SIZE);
        await Promise.all(chunk.map((file, chunkIndex) => uploadSingle(file, i + chunkIndex)));
    }
}

window.saveClient = async () => {
    const date = document.getElementById('clientDate').value;
    const name = document.getElementById('clientName').value;
    const eventName = document.getElementById('eventName').value;
    const phone = document.getElementById('clientPhone').value;
    
    if(!date || !name || !eventName || !phone) 
        return showToast("Please fill all fields.", "warning");

    document.getElementById('btnSaveClient').disabled = true;

    try {
        const newClientId = generateCleanId();
        
        await set(ref(db, `clients/${newClientId}`), {
            date, name, eventName, phone,
            totalSize: 0,
            totalImages: 0,
            totalViews: 0,      
            totalDownloads: 0,  
            paymentStatus: 'calculating', 
            isLocked: false,
            linkStatus: { ai: true, gallery: true, delete: true }, 
            createdAt: Date.now()
        });

        document.getElementById('addClientForm').reset();
        addClientModalInstance.hide();
        showToast("Event Created Successfully! Use 'Add More' to upload photos.", "success");
    } catch (error) { showToast("Error: " + error.message, "error"); }
    document.getElementById('btnSaveClient').disabled = false;
};

window.triggerAddMore = (clientId, clientName) => {
    activeAddClientId = clientId;
    document.getElementById('addMoreClientName').innerText = clientName;
    document.getElementById('addMoreInput').value = '';
    document.getElementById('addMoreCountLabel').innerText = '';
    
    // Reset Views
    document.getElementById('addMoreProgressContainer').style.display = 'none';
    document.getElementById('addMoreDropZone').classList.remove('disabled');
    document.getElementById('btnAddMoreConfirm').disabled = true;
    document.getElementById('btnAddMoreCancel').disabled = false;
    document.getElementById('btnAddMoreClose').disabled = false;
    document.getElementById('globalUploadPercent').innerText = "0%";
    
    addMoreModalInstance.show();
};

window.confirmAddMore = async () => {
    const fileInput = document.getElementById('addMoreInput');
    const files = fileInput.files;
    
    if(!files.length) return;

    // DISABLE INPUTS
    document.getElementById('addMoreDropZone').classList.add('disabled');
    document.getElementById('btnAddMoreConfirm').disabled = true;
    document.getElementById('btnAddMoreCancel').disabled = true;
    document.getElementById('btnAddMoreClose').disabled = true;
    
    // Show new List View
    document.getElementById('addMoreProgressContainer').style.display = 'block';

    let newSize = 0;
    Array.from(files).forEach(f => newSize += f.size);

    // Call new concurrent processor
    await processAndUploadFiles(files, activeAddClientId);

    // Update Client Stats
    await runTransaction(ref(db, `clients/${activeAddClientId}`), (data) => {
        if (data) {
            data.totalSize = (data.totalSize || 0) + newSize;
            data.totalImages = (data.totalImages || 0) + files.length;
        }
        return data;
    });

    addMoreModalInstance.hide();
    showToast("Media added successfully!", "success");
};

window.prepareDeleteClient = (id) => {
    pendingDeleteId = id;
    deleteConfirmModalInstance.show();
};

window.performDeleteClient = async () => {
    if (!pendingDeleteId) return;
    deleteConfirmModalInstance.hide();
    const id = pendingDeleteId;
    try {
        await remove(ref(db, `clients/${id}`));
        await remove(ref(db, `rathnastudio/${id}`));
        showToast("Client deleted successfully.", "success");
    } catch(e) { showToast("Delete failed: " + e.message, "error"); }
    pendingDeleteId = null;
};

window.triggerEdit = async (id) => {
    const snap = await get(ref(db, `clients/${id}`));
    const data = snap.val();
    document.getElementById('editClientId').value = id;
    document.getElementById('editClientName').value = data.name;
    document.getElementById('editEventName').value = data.eventName;
    document.getElementById('editClientDate').value = data.date;
    document.getElementById('editClientPhone').value = data.phone;
    editClientModalInstance.show();
};

window.updateClient = async () => {
    const id = document.getElementById('editClientId').value;
    await update(ref(db, `clients/${id}`), {
        name: document.getElementById('editClientName').value,
        eventName: document.getElementById('editEventName').value,
        date: document.getElementById('editClientDate').value,
        phone: document.getElementById('editClientPhone').value
    });
    editClientModalInstance.hide();
    showToast("Details updated successfully!", "success");
};

window.viewClientGallery = async (id) => {
    currentGalleryId = id;
    isDeleteFilterActive = false;
    
    const client = window.allClientsData.find(c => c.id === id);
    
    document.getElementById('galleryViewClientId').innerText = id;
    document.getElementById('galleryViewClientName').innerText = client ? client.name : 'Unknown Client';
    document.getElementById('galleryViewEventName').innerText = client ? client.eventName : 'Event';
    
    const grid = document.getElementById('galleryGrid');
    grid.innerHTML = '<div class="d-flex justify-content-center w-100 py-5"><div class="spinner-border text-accent" role="status"></div></div>';
    
    const deleteControls = document.getElementById('deleteRequestControls');
    const confirmPanel = document.getElementById('confirmDeletePanel');
    deleteControls.classList.add('d-none');
    confirmPanel.classList.add('d-none');
    currentDeleteRequests = [];
    
    if (client && client.deletionRequests) {
        currentDeleteRequests = client.deletionRequests;
        document.getElementById('delReqCount').innerText = currentDeleteRequests.length;
        deleteControls.classList.remove('d-none');
    }

    switchView('gallery');
    
    try {
        const snap = await get(ref(db, `rathnastudio/${id}`));
        currentPhotosCache = [];
        displayedPhotos = [];
        
        if(snap.exists()) {
            currentPhotosCache = Object.entries(snap.val()).map(([key, val]) => ({ key, ...val }));
            displayedPhotos = currentPhotosCache; 
            renderGalleryGrid(displayedPhotos);
        } else {
            grid.innerHTML = '<p class="text-center text-secondary w-100 py-5 mt-5">No media uploaded for this client yet.</p>';
        }
    } catch(err) {
        console.error(err);
        grid.innerHTML = '<p class="text-center text-danger w-100 py-4">Error loading media.</p>';
    }
};

window.renderGalleryGrid = (photos) => {
    displayedPhotos = photos; 
    
    const grid = document.getElementById('galleryGrid');
    grid.innerHTML = '';
    const fragment = document.createDocumentFragment();
    
    if(photos.length === 0) {
            grid.innerHTML = '<p class="text-center text-secondary w-100 py-5">No photos found.</p>';
            return;
    }

    photos.forEach((p, index) => {
        const isVideo = p.type ? p.type.startsWith('video') : (p.url.match(/\.(mp4|webm|ogg|mov|m4v)$/i) !== null);
        const isRequestedForDelete = currentDeleteRequests.includes(p.url);
        
        const wrapper = document.createElement('div');
        wrapper.className = 'gallery-item-wrapper';
        
        let mediaEl;
        if (isVideo) {
            mediaEl = document.createElement('video');
            mediaEl.src = p.url;
            mediaEl.className = 'gallery-img';
            mediaEl.muted = true;
            mediaEl.loop = true;
            mediaEl.playsInline = true;
            mediaEl.preload = "metadata";
            
            wrapper.onmouseenter = () => mediaEl.play().catch(e => {}); 
            wrapper.onmouseleave = () => { mediaEl.pause(); mediaEl.currentTime = 0; };

            const indicator = document.createElement('div');
            indicator.className = 'video-indicator';
            indicator.innerHTML = '<i class="bi bi-play-fill fs-3"></i>';
            wrapper.appendChild(indicator);
        } else {
            mediaEl = document.createElement('img');
            mediaEl.src = p.url;
            mediaEl.className = 'gallery-img';
            mediaEl.loading = "lazy";
        }
        
        if (isRequestedForDelete) {
            mediaEl.classList.add('delete-selected-img');
            const badge = document.createElement('div');
            badge.className = 'delete-badge';
            badge.innerHTML = '<i class="bi bi-trash-fill me-1"></i>DELETE REQ';
            wrapper.appendChild(badge);
        }
        
        wrapper.onclick = () => window.openLightbox(index);
        
        wrapper.appendChild(mediaEl);
        fragment.appendChild(wrapper);
    });
    grid.appendChild(fragment);
};

window.toggleDeleteFilter = () => {
    isDeleteFilterActive = !isDeleteFilterActive;
    const deleteControls = document.getElementById('deleteRequestControls');
    const confirmPanel = document.getElementById('confirmDeletePanel');

    if (isDeleteFilterActive) {
        deleteControls.classList.add('d-none');
        confirmPanel.classList.remove('d-none');
        const filtered = currentPhotosCache.filter(p => currentDeleteRequests.includes(p.url));
        renderGalleryGrid(filtered);
    }
};

window.cancelDeleteReview = () => {
        isDeleteFilterActive = false;
        document.getElementById('deleteRequestControls').classList.remove('d-none');
        document.getElementById('confirmDeletePanel').classList.add('d-none');
        renderGalleryGrid(currentPhotosCache);
};

window.performPermanentDelete = async () => {
        if (!currentGalleryId || currentDeleteRequests.length === 0) return;
        
        if (!confirm(`Are you sure you want to permanently delete ${currentDeleteRequests.length} items? This cannot be undone.`)) return;

        const btn = document.querySelector('#confirmDeletePanel button.btn-warning');
        btn.disabled = true;
        btn.innerText = 'Deleting...';

        try {
        const photosToDelete = currentPhotosCache.filter(p => currentDeleteRequests.includes(p.url));
        let deletedCount = 0;

        const updates = {};
        photosToDelete.forEach(p => {
            updates[`rathnastudio/${currentGalleryId}/${p.key}`] = null;
            deletedCount++;
        });
        
        updates[`clients/${currentGalleryId}/deletionRequests`] = null;

        await update(ref(db), updates);

        await runTransaction(ref(db, `clients/${currentGalleryId}`), (data) => {
            if (data) {
                const currentCount = Number(data.totalImages || 0);
                data.totalImages = Math.max(0, currentCount - deletedCount);
            }
            return data;
        });

        showToast(`Successfully deleted ${deletedCount} items.`, "success");
        
        btn.disabled = false;
        btn.innerText = 'Confirm Permanent Delete';
        cancelDeleteReview();
        viewClientGallery(currentGalleryId); 
        
        } catch (error) {
            console.error(error);
            showToast("Error deleting items: " + error.message, "error");
            btn.disabled = false;
        }
};

window.copyToClipboard = (t) => {
    navigator.clipboard.writeText(t).then(() => {
        showToast("Link copied to clipboard!", "success");
    });
};