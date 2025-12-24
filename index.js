import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, doc, getDoc, getDocs, collection, updateDoc, increment, enableMultiTabIndexedDbPersistence 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyB5jaPVkCwxXiMYhSn0uuW9QSMc-B5C9YY",
    authDomain: "mjsmartapps.firebaseapp.com",
    projectId: "mjsmartapps",
    storageBucket: "mjsmartapps.firebasestorage.app",
    messagingSenderId: "1033240518010",
    appId: "1:1033240518010:web:930921011dda1bd56e0ac3",
    measurementId: "G-959VLQSHH2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ENABLE OFFLINE PERSISTENCE (Fast Loading on Revisit)
enableMultiTabIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn('Multiple tabs open, persistence can only be enabled in one tab at a a time.');
    } else if (err.code == 'unimplemented') {
        console.warn('The current browser does not support all of the features required to enable persistence');
    }
});

const urlParams = new URLSearchParams(window.location.search);
const eventId = urlParams.get('eventId');
const viewMode = urlParams.get('view'); // 'all' or 'delete'

let deleteSelection = new Set();
let currentMediaList = []; // Stores objects {url, type}
let currentLightboxIndex = 0;

// *** SECURITY: BLOCK SHORTCUTS & DRAGGING ***
document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', event => {
    if (event.ctrlKey && (event.key === 's' || event.key === 'p' || event.key === 'u')) {
        event.preventDefault();
    }
    // Escape to close lightbox
    if (event.key === 'Escape') closeLightbox({target: document.getElementById('mediaLightbox')});
    
    // Arrow keys for lightbox navigation
    if (document.getElementById('mediaLightbox').style.display === 'flex') {
        if (event.key === 'ArrowLeft') changeSlide(-1);
        if (event.key === 'ArrowRight') changeSlide(1);
    }
});

// Initialize Header with Studio Info (Global)
loadStudioProfile();

async function loadStudioProfile() {
    try {
        const snap = await getDoc(doc(db, 'settings', 'profile'));
        if (snap.exists()) {
            const data = snap.data();
            const header = document.getElementById('mainHeader');
            
            if (data.logoUrl) {
                const logo = document.getElementById('headerLogo');
                logo.src = data.logoUrl;
                logo.classList.remove('d-none');
                header.classList.remove('d-none');
            }
            
            if (data.address) {
                const addr = document.getElementById('headerAddress');
                addr.innerText = data.address;
                addr.style.display = 'block';
                header.classList.remove('d-none');
            }
            if (data.mapLink) {
                const map = document.getElementById('headerMap');
                map.href = data.mapLink;
                map.style.display = 'inline-block';
                header.classList.remove('d-none');
            }
            
            if (data.contactPhone) {
                const phone = document.getElementById('headerPhone');
                const phoneText = document.getElementById('headerPhoneText');
                phone.href = `tel:${data.contactPhone}`;
                phoneText.innerText = data.contactPhone;
                phone.classList.remove('d-none'); 
                header.classList.remove('d-none');
            }
        }
    } catch (e) {
        console.warn("Could not load studio profile", e);
    }
}

function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toastContainer');
    let headerClass = type === 'success' ? 'bg-success text-white' : type === 'danger' ? 'bg-danger text-white' : 'bg-primary text-white';
    let icon = type === 'success' ? 'bi-check-circle-fill' : type === 'danger' ? 'bi-exclamation-circle-fill' : 'bi-info-circle-fill';
    
    const toastId = 'toast_' + Date.now();
    const toastHtml = `
        <div id="${toastId}" class="toast border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header ${headerClass} border-0">
                <i class="bi ${icon} me-2"></i>
                <strong class="me-auto">Notification</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body bg-white text-dark rounded-bottom">
                ${message}
            </div>
        </div>
    `;
    toastContainer.insertAdjacentHTML('beforeend', toastHtml);
    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement, { delay: 4000 });
    toast.show();
    toastElement.addEventListener('hidden.bs.toast', () => toastElement.remove());
}

async function updateStat(id, type) {
    if (viewMode === 'delete') return; 
    try {
        const clientRef = doc(db, 'clients', id);
        const field = type === 'view' ? 'totalViews' : 'totalDownloads';
        await updateDoc(clientRef, {
            [field]: increment(1)
        });
    } catch (err) {
        console.error("Stats Error:", err);
    }
}

if (!eventId) {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('errorScreen').classList.remove('d-none');
} else {
    initializeSystem();
}

function showLinkDisabled(featureName) {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('linkDisabledScreen').classList.remove('d-none');
    document.getElementById('disabledFeatureText').innerText = featureName;
}

async function initializeSystem() {
    try {
        const clientSnap = await getDoc(doc(db, 'clients', eventId));
        
        if (!clientSnap.exists()) {
            document.getElementById('loadingScreen').style.display = 'none';
            document.getElementById('errorScreen').classList.remove('d-none');
            return;
        }

        const data = clientSnap.data();

        if (data.isLocked === true) {
            document.getElementById('loadingScreen').style.display = 'none';
            document.getElementById('lockScreen').classList.remove('d-none');
            return; 
        }

        const linkStatus = data.linkStatus || { ai: true, gallery: true, delete: true };

        if (viewMode === 'delete') {
            if (!linkStatus.delete) {
                showLinkDisabled('Deletion Request');
                return;
            }
        } else if (viewMode === 'all') {
            if (!linkStatus.gallery) {
                showLinkDisabled('Full Gallery');
                return;
            }
        } else {
            if (!linkStatus.ai) {
                showLinkDisabled('AI Search');
                return;
            }
        }

        if (viewMode !== 'all' && viewMode !== 'delete') {
            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models'),
                faceapi.nets.faceLandmark68Net.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models'),
                faceapi.nets.faceRecognitionNet.loadFromUri('https://justadudewhohacks.github.io/face-api.js/models')
            ]);
        }

        document.getElementById('eventTitle').innerText = data.eventName || "Gallery";
        document.getElementById('clientNameDisplay').innerText = data.name;

        document.getElementById('loadingScreen').style.display = 'none';
        document.getElementById('appContent').classList.remove('d-none');

        if (viewMode === 'delete') {
            document.getElementById('heroButtons').classList.add('d-none'); 
            document.getElementById('deleteModeHeader').classList.remove('d-none');
            document.getElementById('deleteActionBar').classList.add('active');
            
            document.getElementById('btnSelfie').classList.add('d-none');
            document.getElementById('startCamBtn').classList.add('d-none');
            window.loadFullGallery();
        } else if (viewMode === 'all') {
            updateStat(eventId, 'view');
            document.getElementById('downloadZipBtn').classList.remove('d-none'); 
            
            document.getElementById('btnSelfie').classList.add('d-none');
            document.getElementById('startCamBtn').classList.add('d-none');
            
            window.loadFullGallery();
        } else {
            updateStat(eventId, 'view');
            document.getElementById('btnSelfie').classList.remove('d-none');
            document.getElementById('startCamBtn').classList.remove('d-none');
        }

    } catch (error) {
        console.error(error);
        document.getElementById('loadingScreen').innerHTML = `<p class="text-danger">${error.message}</p>`;
    }
}

// Optimized Batch Rendering
window.loadFullGallery = async () => {
    if (viewMode === 'all') {
        document.getElementById('heroButtons').classList.remove('d-none');
        document.getElementById('btnSelfie').classList.add('d-none');
        document.getElementById('startCamBtn').classList.add('d-none');
    }

    const msg = document.getElementById('searchingMsg');
    msg.classList.remove('d-none');
    document.getElementById('scanningText').innerText = viewMode === 'delete' ? "Loading photos for review..." : "Loading all photos...";
    
    const grid = document.getElementById('resultsGrid');
    grid.innerHTML = '';
    currentMediaList = []; 

    try {
        const mediaCol = collection(db, 'clients', eventId, 'media');
        const snap = await getDocs(mediaCol);
        
        if(!snap.empty) {
            // Batch Append for Performance
            const fragment = document.createDocumentFragment();
            
            snap.forEach((doc) => {
                const p = doc.data();
                const isVideo = p.type ? p.type.startsWith('video') : (p.url.match(/\.(mp4|webm|ogg|mov|m4v)$/i) !== null);
                const enrichedPhoto = {...p, isVideo};
                currentMediaList.push(enrichedPhoto);
                
                const card = createPhotoCard(enrichedPhoto, currentMediaList.length - 1);
                fragment.appendChild(card);
            });
            
            grid.appendChild(fragment);
            msg.classList.add('d-none');
        } else {
            msg.innerHTML = '<span class="text-white">No photos found in this gallery.</span>';
        }
    } catch(e) { console.error(e); }
};

// *** CAMERA LOGIC ***
let stream = null;
let currentFacingMode = 'user'; 
const video = document.getElementById('webcam');

async function startCameraStream() {
    if (stream) stream.getTracks().forEach(t => t.stop());

    try {
        const constraints = { video: { facingMode: currentFacingMode } };
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;

        video.classList.remove('video-mirror', 'video-normal');
        if (currentFacingMode === 'user') {
            video.classList.add('video-mirror');
        } else {
            video.classList.add('video-normal');
        }
    } catch (err) {
        console.error("Camera Error:", err);
        showToast("Unable to access camera. Check permissions.", "danger");
    }
}

document.getElementById('startCamBtn').addEventListener('click', async () => {
    document.getElementById('cameraContainer').style.display = 'block';
    await startCameraStream();
});

document.getElementById('switchCamBtn').addEventListener('click', async () => {
    currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    await startCameraStream();
});

document.getElementById('closeCamBtn').addEventListener('click', () => {
    if (stream) stream.getTracks().forEach(t => t.stop());
    document.getElementById('cameraContainer').style.display = 'none';
});

document.getElementById('snapBtn').addEventListener('click', () => {
    if (!stream) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    if (currentFacingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    
    stream.getTracks().forEach(t => t.stop());
    document.getElementById('cameraContainer').style.display = 'none';
    processSearch(canvas.toDataURL('image/png'));
});

document.getElementById('selfieInput').addEventListener('change', (e) => {
    if (e.target.files[0]) processSearch(URL.createObjectURL(e.target.files[0]));
});

async function processSearch(imageUrl) {
    document.getElementById('userImg').src = imageUrl;
    document.getElementById('referenceSection').classList.remove('d-none');
    document.getElementById('searchingMsg').classList.remove('d-none');
    document.getElementById('heroButtons').classList.add('d-none');
    document.getElementById('resultsGrid').innerHTML = '';
    currentMediaList = []; 
    
    try {
        const img = await faceapi.fetchImage(imageUrl);
        const detection = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();

        if (!detection) {
            showToast("No face detected. Please try again.", "danger");
            document.getElementById('searchingMsg').classList.add('d-none');
            document.getElementById('heroButtons').classList.remove('d-none');
            return;
        }

        const mediaCol = collection(db, 'clients', eventId, 'media');
        const snap = await getDocs(mediaCol);
        
        let count = 0;
        const fragment = document.createDocumentFragment();

        if (!snap.empty) {
            snap.forEach(doc => {
                const photo = doc.data();
                if (photo.descriptors && photo.descriptors.some(d => {
                    const descriptorArray = d.values || d; 
                    return faceapi.euclideanDistance(detection.descriptor, new Float32Array(descriptorArray)) < 0.5;
                })) {
                    const isVideo = photo.type ? photo.type.startsWith('video') : (photo.url.match(/\.(mp4|webm|ogg|mov|m4v)$/i) !== null);
                    const enrichedPhoto = {...photo, isVideo};
                    currentMediaList.push(enrichedPhoto);
                    fragment.appendChild(createPhotoCard(enrichedPhoto, currentMediaList.length - 1));
                    count++;
                }
            });
        }
        document.getElementById('resultsGrid').appendChild(fragment);

        document.getElementById('matchCount').innerText = count > 0 ? `Found ${count} photos!` : "No matches found.";
        if(count === 0) showToast("No matches found for this face.", "warning");
        else showToast(`Found ${count} photos matching your face!`, "success");

    } catch (err) { 
        console.error(err);
        showToast("Error processing search.", "danger");
    } 
    finally { document.getElementById('searchingMsg').classList.add('d-none'); }
}

function getSafeFilename(url) {
    let cleanUrl = url.split('?')[0];
    let filename = cleanUrl.split('/').pop();
    filename = decodeURIComponent(filename);
    
    let parts = filename.split('.');
    let ext = parts.length > 1 ? parts.pop() : '';
    let name = parts.join('.'); 
    
    name = name.replace(/_/g, '-');
    name = name.replace(/[^a-zA-Z0-9-]/g, '');
    
    ext = ext.replace(/[^a-zA-Z0-9]/g, '');
    if (!ext) ext = 'bin'; 
    
    return `${name}.${ext}`;
}

window.forceDownload = async (url) => {
    updateStat(eventId, 'download');
    showToast("Starting download...", "info");
    
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error("Network error");
        const blob = await response.blob();
        const safeName = getSafeFilename(url);
        saveAs(blob, safeName);
        showToast("Download complete!", "success");
    } catch (error) {
        console.error("Download failed:", error);
        const a = document.createElement('a');
        a.href = url;
        a.download = ''; 
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
};

// ** Optimized Concurrent Download Queue **
window.downloadAllZip = async () => {
    if (currentMediaList.length === 0) return showToast("No photos to download.", "warning");

    const loader = document.getElementById('loadingScreen');
    const loaderText = document.getElementById('loadingText');
    loader.classList.remove('d-none');
    loaderText.innerText = "Preparing ZIP file...";

    const zip = new JSZip();
    const folder = zip.folder("rathnastudio"); 
    const existingNames = new Set(); 
    let processed = 0;

    // Helper: Download one file
    const downloadOne = async (media) => {
        try {
            const response = await fetch(media.url, { mode: 'cors' });
            if(!response.ok) throw new Error("Fetch failed");
            const blob = await response.blob();
            
            let safeName = getSafeFilename(media.url);
            let finalName = safeName;
            let counter = 1;
            let namePart = safeName.substring(0, safeName.lastIndexOf('.'));
            let extPart = safeName.substring(safeName.lastIndexOf('.'));

            while (existingNames.has(finalName)) {
                finalName = `${namePart}-${counter}${extPart}`;
                counter++;
            }
            existingNames.add(finalName);
            folder.file(finalName, blob);
        } catch (e) {
            console.warn("Skipped file:", media.url);
        } finally {
            processed++;
            const pct = Math.round((processed / currentMediaList.length) * 100);
            loaderText.innerText = `Compressing: ${pct}%`;
        }
    };

    // Concurrency Control: Max 5 downloads at once
    const CONCURRENCY_LIMIT = 5;
    const executing = [];
    
    for (const media of currentMediaList) {
        const p = downloadOne(media).then(() => {
            executing.splice(executing.indexOf(p), 1);
        });
        executing.push(p);
        if (executing.length >= CONCURRENCY_LIMIT) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);

    loaderText.innerText = "Finalizing ZIP file...";
    try {
        const content = await zip.generateAsync({type:"blob"});
        const safeEventId = eventId.replace(/[^a-zA-Z0-9]/g, '-');
        saveAs(content, `Gallery-${safeEventId}.zip`);
        showToast("ZIP Downloaded Successfully!", "success");
    } catch (err) {
        showToast("Error creating ZIP: " + err.message, "danger");
    } finally {
        loader.classList.add('d-none');
        loaderText.innerText = "Loading Event...";
    }
};

window.toggleDeleteSelect = (url) => {
    const targetCard = document.querySelector(`.photo-card[data-url="${url}"]`);

    if (deleteSelection.has(url)) {
        deleteSelection.delete(url);
        if(targetCard) {
            targetCard.classList.remove('selected-for-delete');
            const btn = targetCard.querySelector('.btn-mark-delete');
            if(btn) {
                btn.classList.replace('btn-danger', 'btn-outline-danger');
                btn.innerHTML = '<i class="bi bi-trash"></i> Mark';
            }
        }
        if (document.getElementById('mediaLightbox').style.display === 'flex' && currentMediaList[currentLightboxIndex].url === url) {
            const lbBtn = document.getElementById('lbDeleteBtn');
            if(lbBtn) {
                lbBtn.classList.replace('btn-danger', 'btn-outline-light');
                lbBtn.innerHTML = '<i class="bi bi-trash"></i> Mark to Delete';
            }
        }
    } else {
        deleteSelection.add(url);
        if(targetCard) {
            targetCard.classList.add('selected-for-delete');
            const btn = targetCard.querySelector('.btn-mark-delete');
            if(btn) {
                btn.classList.replace('btn-outline-danger', 'btn-danger');
                btn.innerHTML = '<i class="bi bi-check-lg"></i> Marked';
            }
        }
        if (document.getElementById('mediaLightbox').style.display === 'flex' && currentMediaList[currentLightboxIndex].url === url) {
            const lbBtn = document.getElementById('lbDeleteBtn');
            if(lbBtn) {
                lbBtn.classList.replace('btn-outline-light', 'btn-danger');
                lbBtn.innerHTML = '<i class="bi bi-check-lg"></i> Marked for Deletion';
            }
        }
    }
    document.getElementById('selectedCount').innerText = deleteSelection.size;
};

// *** LIGHTBOX FUNCTIONS ***
window.openFullscreen = (index) => {
    if (index < 0 || index >= currentMediaList.length) return;
    
    currentLightboxIndex = index;
    const item = currentMediaList[index];
    const url = item.url;
    const isVideo = item.isVideo;

    const overlay = document.getElementById('mediaLightbox');
    const container = document.getElementById('lightboxContainer');
    const actions = document.getElementById('lightboxActionBar');
    
    container.innerHTML = '';
    actions.innerHTML = '';

    if (isVideo) {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        video.className = 'lightbox-content';
        container.appendChild(video);
    } else {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'lightbox-content';
        container.appendChild(img);
    }

    if (viewMode === 'delete') {
        const isSelected = deleteSelection.has(url);
        const btnClass = isSelected ? 'btn-danger' : 'btn-outline-light';
        const btnText = isSelected ? '<i class="bi bi-check-lg"></i> Marked for Deletion' : '<i class="bi bi-trash"></i> Mark to Delete';
        
        actions.innerHTML = `
            <button id="lbDeleteBtn" class="btn btn-lg ${btnClass} px-4 rounded-pill" onclick="toggleDeleteSelect('${url}')">
                ${btnText}
            </button>
        `;
    } else {
        actions.innerHTML = `
            <button class="btn btn-lg btn-white text-dark px-5 rounded-pill shadow" onclick="forceDownload('${url}')">
                <i class="bi bi-download me-2"></i> Download High-Res
            </button>
        `;
    }

    overlay.style.display = 'flex';
};

window.changeSlide = (step) => {
    let newIndex = currentLightboxIndex + step;
    if (newIndex < 0) newIndex = currentMediaList.length - 1;
    if (newIndex >= currentMediaList.length) newIndex = 0;
    
    const container = document.getElementById('lightboxContainer');
    const video = container.querySelector('video');
    if (video) video.pause();

    openFullscreen(newIndex);
};

window.closeLightbox = (e) => {
    if (e.target.id === 'mediaLightbox' || e.target.classList.contains('lightbox-close-btn') || e.target.closest('.lightbox-close-btn') || e.target.id === 'lightboxContainer') {
        const overlay = document.getElementById('mediaLightbox');
        const container = document.getElementById('lightboxContainer');
        
        const video = container.querySelector('video');
        if (video) video.pause();
        
        overlay.style.display = 'none';
        container.innerHTML = '';
    }
};

window.submitDeletionRequest = async () => {
    if (deleteSelection.size === 0) return showToast("No photos selected.", "warning");

    const btn = document.getElementById('btnSubmitDelete');
    btn.disabled = true;
    btn.innerText = "Submitting...";

    try {
        const requests = Array.from(deleteSelection);
        const clientRef = doc(db, 'clients', eventId);
        await updateDoc(clientRef, { deletionRequests: requests });
        
        showToast("Request sent! Admin will review deletion.", "success");
        setTimeout(() => location.href = location.href.split('?')[0] + `?eventId=${eventId}`, 2000); 
    } catch (error) {
        showToast("Error: " + error.message, "danger");
        btn.disabled = false;
        btn.innerText = "Submit Request";
    }
};

// Helper: Create Photo Card DOM Element (Optimized for Batching)
function createPhotoCard(photo, index) {
    const div = document.createElement('div');
    div.className = 'col-6 col-md-4 col-lg-3';
    
    let mediaHtml = '';
    // Added decoding="async" for smoother scrolling on images
    if (photo.isVideo) {
        mediaHtml = `
            <div class="position-relative">
                <video src="${photo.url}#t=0.1" class="gallery-media" preload="metadata" muted></video>
                <div class="video-indicator"><i class="bi bi-play-fill"></i></div>
            </div>`;
    } else {
        mediaHtml = `<img src="${photo.url}" class="gallery-media" loading="lazy" decoding="async">`;
    }

    let buttonsHtml = '';
    if (viewMode === 'delete') {
        buttonsHtml = `
            <div class="d-flex gap-2 mt-2 px-2 pb-2">
                <button onclick="openFullscreen(${index})" class="btn btn-sm btn-outline-dark rounded-pill flex-grow-1">
                    <i class="bi bi-eye"></i>
                </button>
                <button onclick="toggleDeleteSelect('${photo.url}')" class="btn btn-sm btn-outline-danger rounded-pill flex-grow-1 btn-mark-delete">
                    <i class="bi bi-trash"></i> Mark
                </button>
            </div>`;
    } else {
        buttonsHtml = `
            <div class="d-flex gap-2 mt-2 px-2 pb-2">
                <button onclick="openFullscreen(${index})" class="btn btn-sm btn-light rounded-pill flex-grow-1">
                    View
                </button>
                <button onclick="event.stopPropagation(); forceDownload('${photo.url}')" class="btn btn-sm btn-dark rounded-pill flex-grow-1">
                    Download
                </button>
            </div>`;
    }

    div.innerHTML = `
        <div class="card photo-card h-100" data-url="${photo.url}">
            <div onclick="openFullscreen(${index})">
                ${mediaHtml}
                <div class="selected-overlay">
                    <span class="bg-danger text-white rounded-circle p-3 shadow-lg">
                        <i class="bi bi-check-lg display-6"></i>
                    </span>
                </div>
            </div>
            ${buttonsHtml}
        </div>`;
    return div;
}