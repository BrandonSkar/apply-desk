// Keeps a copy of your resume in the extension, so lever.js can attach it.
const current = document.getElementById('current');
const status = document.getElementById('status');

async function show() {
  const { resume } = await chrome.storage.local.get('resume');
  current.textContent = resume ? `Current: ${resume.name} (saved ${new Date(resume.savedAt).toLocaleDateString()})` : 'No resume yet.';
}

document.getElementById('file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const data = String(reader.result).split(',')[1];
    await chrome.storage.local.set({ resume: { name: file.name, type: file.type, data, savedAt: Date.now() } });
    status.textContent = 'Saved.';
    show();
  };
  reader.readAsDataURL(file);
});

show();
