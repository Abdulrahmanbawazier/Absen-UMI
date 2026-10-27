// app.js - Full Interactive Logic for Absensi & Stok Material

const API_BASE = (window.location.protocol === 'file:') ? 'http://localhost:3000' : '';

async function fetchApi(url, options = {}) {
  try {
    const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`;
    const res = await fetch(fullUrl, options);
    return res;
  } catch (err) {
    console.error('Fetch error for', url, err);
    showToast(`Koneksi server terputus (${err.message})`, 'error');
    throw err;
  }
}

let state = {
  currentDate: '',
  appInfo: {},
  workers: [],
  archivedWorkers: [],
  materials: [],
  attendanceRecords: [],
  attendanceSession: null,
  dashboardData: null,
  payrollData: null,
  selectedCategory: 'ALL',
  isWagesUnlocked: false,
  isPayrollUnlocked: false,
  isSettingsUnlocked: false,
  pendingSickWorkerId: null,
  pendingLoanWorkerId: null,
  pendingOvertimeWorkerId: null,
  pendingPinAction: null,
  formIsMandor: false,
  materialSort: { key: 'category', dir: 'asc' }
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  setupEventListeners();
  initDate();

  // Matikan semua autofill browser dari web ini
  const disableAutofill = () => {
    document.querySelectorAll('form').forEach(f => f.setAttribute('autocomplete', 'off'));
    document.querySelectorAll('input').forEach(i => {
      i.setAttribute('autocomplete', 'off');
      i.setAttribute('autocorrect', 'off');
      i.setAttribute('autocapitalize', 'off');
      i.setAttribute('spellcheck', 'false');
    });
  };
  disableAutofill();
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT') {
      e.target.setAttribute('autocomplete', 'off');
    }
  });

  try {
    await loadAppInfo();
    await loadDashboardData();
    await loadMaterials();
    await loadWorkers();
    await loadAttendance(state.currentDate);
    setupSSE();
  } catch (err) {
    console.error('Initialization error:', err);
  }
  feather.replace();
});

function initDate() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const wib = new Date(utc + 7 * 3600000);
  
  const yyyy = wib.getFullYear();
  const mm = String(wib.getMonth() + 1).padStart(2, '0');
  const dd = String(wib.getDate()).padStart(2, '0');
  state.currentDate = `${yyyy}-${mm}-${dd}`;

  const picker = document.getElementById('attendance-date-picker');
  if (picker) picker.value = state.currentDate;

  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const dayName = days[wib.getDay()];
  const monthName = months[wib.getMonth()];
  const dateStr = `${dayName}, ${wib.getDate()} ${monthName} ${yyyy}`;
  
  const dashDate = document.getElementById('dashboard-date-display');
  if (dashDate) dashDate.innerText = dateStr;
}

function initTheme() {
  const savedTheme = localStorage.getItem('app-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('theme-icon');
  const iconMobile = document.getElementById('theme-icon-mobile');
  const iconName = theme === 'dark' ? 'sun' : 'moon';
  if (icon) icon.setAttribute('data-feather', iconName);
  if (iconMobile) iconMobile.setAttribute('data-feather', iconName);
  feather.replace();
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('app-theme', next);
  updateThemeIcon(next);
}

// --- REALTIME SYNC (SSE) ---
function setupSSE() {
  try {
    const sseUrl = `${API_BASE}/api/events`;
    const es = new EventSource(sseUrl);
    es.onopen = () => {
      const badge = document.getElementById('sync-text');
      if (badge) badge.innerText = 'Sistem Online';
    };
    es.onmessage = async (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'attendance_updated') {
          const isTypingJob = document.activeElement && (
            document.activeElement.classList.contains('job-input') ||
            document.activeElement.closest('#attendance-tables-container')
          );
          if (isTypingJob) {
            await loadDashboardData();
          } else {
            await loadDashboardData();
            if (state.currentDate === data.date) {
              await loadAttendance(state.currentDate);
            }
          }
        } else if (data.type === 'materials_updated') {
          const isRecentLocalEdit = (Date.now() - (state.lastMaterialEditTime || 0)) < 4000;
          const isTableFocused = document.activeElement && (
            document.activeElement.classList.contains('table-input') ||
            document.activeElement.closest('#materials-table-container') ||
            document.activeElement.closest('#materials-tbody')
          );

          if (isRecentLocalEdit || isTableFocused) {
            // Edit lokal / kursor masih aktif di tabel: jangan munculkan toast & jangan render ulang tabel agar kursor tidak hilang
            loadDashboardData();
          } else {
            // Update dari luar saat tidak sedang mengedit
            await loadDashboardData();
            await loadMaterials();
          }
        } else if (data.type === 'workers_updated') {
          await loadWorkers();
          await loadAttendance(state.currentDate);
        } else if (data.type === 'loans_updated') {
          showToast('Data kasbon diperbarui!', 'info');
          if (state.isPayrollUnlocked) loadWeeklyPayroll();
        } else if (data.type === 'settings_updated') {
          await loadAppInfo();
        } else if (data.type === 'payroll_reset') {
          showToast('Siklus mingguan otomatis direset (Hari Minggu 07:00 WIB)', 'info');
          if (state.isPayrollUnlocked) loadWeeklyPayroll();
        }
      } catch (err) {
        console.error('SSE error:', err);
      }
    };
    es.onerror = () => {
      const badge = document.getElementById('sync-text');
      if (badge) badge.innerText = 'Menyambung ulang...';
    };
  } catch (err) {
    console.error('SSE init error:', err);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

// --- EVENT LISTENERS ---
function setupEventListeners() {
  document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);

  const navButtons = document.querySelectorAll('.nav-item, .mobile-nav-item');
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      switchTab(targetId);
    });
  });

  document.getElementById('attendance-date-picker')?.addEventListener('change', (e) => {
    state.currentDate = e.target.value;
    loadAttendance(state.currentDate);
  });

  document.getElementById('btn-process-attendance')?.addEventListener('click', openProcessAttendanceModal);
  document.getElementById('btn-confirm-process-attendance')?.addEventListener('click', submitProcessAttendance);
  document.getElementById('input-submitter-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitProcessAttendance();
    }
  });

  document.getElementById('btn-save-sick-allowance')?.addEventListener('click', saveSickAllowance);
  document.getElementById('btn-save-loan')?.addEventListener('click', submitWorkerLoan);
  document.getElementById('btn-save-overtime-options')?.addEventListener('click', saveOvertimeOptions);

  document.querySelectorAll('input[name="ot-choice"]').forEach(r => {
    r.addEventListener('change', (e) => {
      const groupCustom = document.getElementById('group-custom-ot-hours');
      if (groupCustom) groupCustom.style.display = e.target.value === 'custom_hours' ? 'block' : 'none';
    });
  });

  // Workers
  document.getElementById('btn-unlock-wages')?.addEventListener('click', handleUnlockWages);
  document.getElementById('btn-open-archive')?.addEventListener('click', handleOpenArchive);
  document.getElementById('btn-add-worker-modal')?.addEventListener('click', () => openWorkerModal());
  document.getElementById('btn-save-worker')?.addEventListener('click', submitWorkerForm);
  document.getElementById('btn-toggle-mandor-star')?.addEventListener('click', toggleMandorStar);

  // Materials
  document.getElementById('btn-add-material-modal')?.addEventListener('click', () => openMaterialModal());
  document.getElementById('btn-save-material')?.addEventListener('click', submitMaterialForm);

  // Material Category Filter Buttons (MENYALA SAAT AKTIF)
  const catBtns = document.querySelectorAll('.mat-cat-btn');
  catBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      catBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedCategory = btn.getAttribute('data-category');
      renderMaterialsTable();
    });
  });

  // Material Table Header Sorting
  document.querySelectorAll('#materials-table th.sortable-th').forEach(th => {
    th.addEventListener('click', () => {
      const sortKey = th.getAttribute('data-sort-key');
      if (state.materialSort.key === sortKey) {
        state.materialSort.dir = state.materialSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.materialSort.key = sortKey;
        state.materialSort.dir = 'asc';
      }
      renderMaterialsTable();
    });
  });

  // Payroll Verification & PDF
  document.getElementById('btn-verify-payroll-pin')?.addEventListener('click', verifyPayrollPin);
  document.getElementById('input-payroll-pin')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      verifyPayrollPin();
    }
  });
  document.getElementById('btn-download-pdf-payroll')?.addEventListener('click', () => downloadPayrollPDF());

  // PDF Downloads (Real Direct PDF Files)
  document.getElementById('btn-download-pdf-attendance')?.addEventListener('click', () => downloadAttendancePDF());
  document.getElementById('btn-download-pdf-attendance-page')?.addEventListener('click', () => downloadAttendancePDF());
  document.getElementById('btn-download-pdf-material')?.addEventListener('click', () => downloadMaterialPDF());
  document.getElementById('btn-download-pdf-material-page')?.addEventListener('click', () => downloadMaterialPDF());
  document.getElementById('btn-download-pdf-material-yesterday')?.addEventListener('click', () => downloadYesterdayMaterialPDF());

  // Settings PIN & History
  document.getElementById('btn-verify-settings-pin')?.addEventListener('click', verifySettingsPin);
  document.getElementById('input-settings-pin')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      verifySettingsPin();
    }
  });
  document.getElementById('btn-refresh-payroll-history')?.addEventListener('click', loadPayrollHistory);
  document.getElementById('form-settings')?.addEventListener('submit', submitSettingsForm);
  document.getElementById('btn-theme-toggle-mobile')?.addEventListener('click', toggleTheme);

  // Modal Close
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
    });
  });

  // PIN modal
  document.getElementById('btn-submit-modal-pin')?.addEventListener('click', submitModalPin);
  document.getElementById('input-modal-pin')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') submitModalPin();
  });
}

function switchTab(tabId) {
  // 1. Kunci ulang Rekap Upah saat pindah ke halaman lain
  if (tabId !== 'tab-payroll') {
    state.isPayrollUnlocked = false;
    const lockedView = document.getElementById('payroll-locked-view');
    const unlockedView = document.getElementById('payroll-unlocked-view');
    if (lockedView) lockedView.style.display = 'flex';
    if (unlockedView) unlockedView.style.display = 'none';
    const pinInput = document.getElementById('input-payroll-pin');
    if (pinInput) pinInput.value = '';
  }

  // 2. Kunci ulang Pengaturan saat pindah ke halaman lain
  if (tabId !== 'tab-settings') {
    state.isSettingsUnlocked = false;
    const lockedView = document.getElementById('settings-locked-view');
    const unlockedView = document.getElementById('settings-unlocked-view');
    if (lockedView) lockedView.style.display = 'flex';
    if (unlockedView) unlockedView.style.display = 'none';
    const pinInput = document.getElementById('input-settings-pin');
    if (pinInput) pinInput.value = '';
  }

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === tabId);
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  feather.replace();

  if (tabId === 'tab-dashboard') loadDashboardData();
  if (tabId === 'tab-payroll') {
    if (state.isPayrollUnlocked) {
      loadWeeklyPayroll();
    } else {
      setTimeout(() => {
        const pinInput = document.getElementById('input-payroll-pin');
        if (pinInput) {
          pinInput.focus();
          pinInput.select();
        }
      }, 60);
    }
  }
  if (tabId === 'tab-settings') {
    if (state.isSettingsUnlocked) {
      loadAppInfo();
      loadPayrollHistory();
    } else {
      setTimeout(() => {
        const pinInput = document.getElementById('input-settings-pin');
        if (pinInput) {
          pinInput.focus();
          pinInput.select();
        }
      }, 60);
    }
  }
}

// --- API LOADERS ---

// 1. App Info
async function loadAppInfo() {
  try {
    const res = await fetchApi('/api/info');
    const data = await res.json();
    state.appInfo = data;

    const compEl = document.getElementById('header-company');
    const projEl = document.getElementById('header-project');
    if (compEl) compEl.innerText = data.companyName;
    if (projEl) projEl.innerText = data.projectName;

    const mCompEl = document.getElementById('mobile-header-company');
    const mProjEl = document.getElementById('mobile-header-project');
    if (mCompEl) mCompEl.innerText = data.companyName;
    if (mProjEl) mProjEl.innerText = data.projectName;

    const setComp = document.getElementById('setting-company-name');
    const setProj = document.getElementById('setting-project-name');
    if (setComp) setComp.value = data.companyName;
    if (setProj) setProj.value = data.projectName;
  } catch (err) {
    console.error('Error loading app info', err);
  }
}

// 2. Dashboard Data & Charts
let materialChartInstance = null;
let specialistChartInstance = null;

async function loadDashboardData() {
  try {
    const res = await fetchApi('/api/dashboard');
    const data = await res.json();
    state.dashboardData = data;

    // Submitter / Corrector Info (Bisa lebih dari 1 orang dan berkali-kali)
    const subEl = document.getElementById('dash-attendance-submitter');
    if (subEl) {
      if (!data.session || !data.session.submitter_name) {
        subEl.innerHTML = `<span style="color: var(--text-light);"><i data-feather="clock" style="width: 13px;"></i> Belum diproses hari ini</span>`;
      } else {
        let html = `<span>Diabsen oleh: <strong style="color: var(--text-main);">${escapeHtml(data.session.submitter_name)}</strong></span>`;
        if (data.session.corrector_names && data.session.corrector_names.trim()) {
          html += ` <span style="color: var(--text-light); margin: 0 4px;">|</span> <span>Dikoreksi oleh: <strong style="color: var(--warning);">${escapeHtml(data.session.corrector_names)}</strong></span>`;
        }
        subEl.innerHTML = html;
      }
    }

    const totalPresEl = document.getElementById('dash-total-present');
    if (totalPresEl) totalPresEl.innerText = data.totalPresent || 0;

    // 4 KARTU: TK Besi, Tukang Kayu, Tukang (Batu & Tenaga), MEP (Elektrikal, Plumbing, Mekanikal)
    const categoryMap = {
      'TK Besi': { countEl: 'stat-count-besi', deltaEl: 'stat-delta-besi', defaultText: 'Tukang Besi & Perakitan' },
      'Tukang Kayu': { countEl: 'stat-count-kayu', deltaEl: 'stat-delta-kayu', defaultText: 'Bekisting & Kayu' },
      'Tukang':  { countEl: 'stat-count-tukang', deltaEl: 'stat-delta-tukang', defaultText: 'Tk Batu & Tenaga' },
      'MEP':     { countEl: 'stat-count-mep', deltaEl: 'stat-delta-mep', defaultText: 'Elektrikal, Plumbing, Mekanikal' }
    };

    (data.categoryAttendanceCards || []).forEach(cat => {
      const cfg = categoryMap[cat.category];
      if (cfg) {
        const cEl = document.getElementById(cfg.countEl);
        const dEl = document.getElementById(cfg.deltaEl);
        if (cEl) cEl.innerHTML = `${cat.countToday} <span style="font-size: 0.85rem; font-weight: 500; color: var(--text-muted);">Orang</span>`;
        if (dEl) {
          if (cat.badgeText) {
            const isPlus = cat.diff > 0;
            const badgeClass = isPlus ? 'pill-delta-plus' : 'pill-delta-minus';
            dEl.innerHTML = `<span class="${badgeClass}">${cat.badgeText} dibanding kemarin</span>`;
          } else {
            dEl.innerHTML = `<span>${cfg.defaultText}</span>`;
          }
        }
      }
    });

    // Low stock warning banner
    const alertContainer = document.getElementById('low-stock-alert-container');
    if (alertContainer) {
      if (data.lowStockMaterials && data.lowStockMaterials.length > 0) {
        const itemNames = data.lowStockMaterials.map(m => `<strong>${escapeHtml(m.name)}</strong> (${m.stock_today} ${m.unit})`).join(', ');
        alertContainer.innerHTML = `
          <div class="alert-box" style="padding: 0.65rem 0.95rem; margin-bottom: 0.85rem;">
            <div class="alert-content">
              <i data-feather="alert-triangle" style="width: 18px; height: 18px;"></i>
              <span><strong>PERINGATAN LOW STOK:</strong> ${itemNames} di bawah batas minimum!</span>
            </div>
            <button class="btn btn-sm btn-outline" style="border-color: currentColor; color: inherit;" onclick="switchTab('tab-materials')">Lihat Stok</button>
          </div>
        `;
      } else {
        alertContainer.innerHTML = '';
      }
    }

    // LAPORAN PEKERJAAN HARIAN SIMPEL (Nama | Jabatan | Pekerjaan)
    const jobsTbody = document.getElementById('dash-simple-jobs-tbody');
    if (jobsTbody) {
      if (data.simpleJobsList && data.simpleJobsList.length > 0) {
        jobsTbody.innerHTML = data.simpleJobsList.map((j, idx) => `
          <tr>
            <td style="color: var(--text-muted);">${idx + 1}</td>
            <td><strong>${escapeHtml(j.name)}</strong></td>
            <td><span class="specialist-pill" style="font-size: 0.74rem;">${escapeHtml(j.specialist)}</span></td>
            <td>${escapeHtml(j.job)}</td>
          </tr>
        `).join('');
      } else {
        jobsTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.25rem;">Belum ada laporan pekerjaan yang diinput hari ini.</td></tr>`;
      }
    }

    renderDashboardCharts(data);
    feather.replace();
  } catch (err) {
    console.error('Error loading dashboard data', err);
  }
}

function renderDashboardCharts(data) {
  const matCanvas = document.getElementById('chartMaterialMovement');
  if (matCanvas) {
    const labels = (data.historicalMaterials || []).map(h => {
      const parts = h.date.split('-');
      return `${parts[2]}/${parts[1]}`;
    });
    const dataIn = (data.historicalMaterials || []).map(h => h.total_in || 0);
    const dataOut = (data.historicalMaterials || []).map(h => h.total_out || 0);

    if (materialChartInstance) materialChartInstance.destroy();

    materialChartInstance = new Chart(matCanvas, {
      type: 'line',
      data: {
        labels: labels.length > 0 ? labels : ['Hari Ini'],
        datasets: [
          {
            label: 'Masuk',
            data: dataIn.length > 0 ? dataIn : [0],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            tension: 0.25,
            fill: true
          },
          {
            label: 'Keluar',
            data: dataOut.length > 0 ? dataOut : [0],
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            tension: 0.25,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } }
        },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(148, 163, 184, 0.15)' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  const workerCanvas = document.getElementById('chartWorkerSpecialists');
  if (workerCanvas) {
    const cards = (data.categoryAttendanceCards || []).filter(c => c.countToday > 0);
    const labels = cards.map(c => c.category);
    const counts = cards.map(c => c.countToday);

    if (specialistChartInstance) specialistChartInstance.destroy();

    const colors = ['#0284c7', '#d97706', '#059669', '#7c3aed'];

    specialistChartInstance = new Chart(workerCanvas, {
      type: 'doughnut',
      data: {
        labels: labels.length > 0 ? labels : ['Belum Ada Tukang Hadir'],
        datasets: [{
          data: counts.length > 0 ? counts : [1],
          backgroundColor: counts.length > 0 ? colors.slice(0, counts.length) : ['#cbd5e1'],
          borderWidth: 2,
          borderColor: 'transparent'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
        },
        cutout: '65%'
      }
    });
  }
}

// 3. Workers Data
async function loadWorkers() {
  try {
    const res = await fetchApi('/api/workers');
    state.workers = await res.json();
    renderWorkersTable();
    populateMandorDropdowns();
  } catch (err) {
    console.error('Error loading workers', err);
  }
}

function renderWorkersTable() {
  const container = document.getElementById('workers-mandor-groups-container');
  if (!container) return;

  if (state.workers.length === 0) {
    container.innerHTML = `<div class="card" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Belum ada data tukang. Silakan klik Tambah Tukang atau Muat 10 Contoh Tukang.</div>`;
    return;
  }

  // Find all Mandors
  const mandorWorkers = state.workers.filter(w => w.is_mandor === 1);
  const mandorIds = new Set(mandorWorkers.map(m => m.id));

  const groups = [];

  mandorWorkers.forEach(mandor => {
    const members = state.workers.filter(w => w.mandor_id === mandor.id && w.id !== mandor.id);
    groups.push({
      mandorId: mandor.id,
      mandorName: mandor.name,
      mandorSpec: mandor.specialist,
      mandorRecord: mandor,
      members: [mandor, ...members]
    });
  });

  const independentMembers = state.workers.filter(w => !w.is_mandor && (!w.mandor_id || !mandorIds.has(w.mandor_id)));
  if (independentMembers.length > 0) {
    groups.push({
      mandorId: 999999,
      mandorName: 'Tukang Mandiri / Non-Grup',
      mandorSpec: 'Umum',
      mandorRecord: null,
      members: independentMembers
    });
  }

  container.innerHTML = groups.map(grp => {
    return `
      <div class="card" style="margin-bottom: 1.15rem; padding: 0.85rem 1rem;">
        <div class="card-header-flex" style="border-bottom: 1px solid var(--border); padding-bottom: 0.45rem; margin-bottom: 0.65rem;">
          <div>
            <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main);">
              ${grp.mandorRecord ? `⭐ Tim Mandor: ${escapeHtml(grp.mandorName)} (${escapeHtml(grp.mandorSpec)})` : escapeHtml(grp.mandorName)}
            </h3>
            <span style="font-size: 0.74rem; color: var(--text-muted);">${grp.members.length} Orang Tukang</span>
          </div>
        </div>

        <div class="table-responsive" style="margin-bottom: 0;">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 35px;">No</th>
                <th>Nama Tukang</th>
                <th>Status / Peran</th>
                <th>Spesialis</th>
                <th style="text-align: center;">Tanggal Gabung</th>
                <th style="text-align: right;">Upah Harian</th>
                <th style="text-align: right;">Upah Jam Ekstra</th>
                <th style="text-align: center;">Aksi</th>
              </tr>
            </thead>
            <tbody>
              ${grp.members.map((w, index) => {
                const dailyWageDisplay = state.isWagesUnlocked ? formatRupiah(w.daily_wage) : 'Rp •••••••';
                const hourlyRateDisplay = state.isWagesUnlocked ? formatRupiah(w.hourly_overtime_rate) : 'Rp •••••••';
                const statusRole = w.is_mandor 
                  ? `<span class="mandor-badge-star">⭐ Mandor</span>` 
                  : `<span style="color: var(--text-muted); font-size: 0.74rem;">Tukang</span>`;

                return `
                  <tr>
                    <td style="color: var(--text-muted);">${index + 1}</td>
                    <td>
                      <strong>${escapeHtml(w.name)}</strong>
                      ${w.is_mandor ? `<span class="mandor-badge-star" style="margin-left: 4px;">Mandor</span>` : ''}
                    </td>
                    <td>${statusRole}</td>
                    <td><span class="specialist-pill">${escapeHtml(w.specialist)}</span></td>
                    <td style="text-align: center; font-size: 0.74rem; color: var(--text-muted);">${formatShortDate(w.created_at)}</td>
                    <td style="text-align: right; font-weight: 600;">${dailyWageDisplay}</td>
                    <td style="text-align: right; font-weight: 600;">${hourlyRateDisplay}</td>
                    <td style="text-align: center;">
                      <div style="display: inline-flex; gap: 0.3rem;">
                        <button class="btn btn-outline btn-sm" onclick="openWorkerModal(${w.id})" title="Edit Tukang"><i data-feather="edit-2" style="width: 12px;"></i></button>
                        <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="archiveWorker(${w.id}, '${escapeHtml(w.name)}')" title="Hapus"><i data-feather="trash-2" style="width: 12px;"></i></button>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  feather.replace();
}

function populateMandorDropdowns() {
  const select = document.getElementById('worker-mandor-id');
  if (!select) return;
  const mandors = state.workers.filter(w => w.is_mandor === 1);
  select.innerHTML = '<option value="">-- Tukang Mandiri / Non-Grup --</option>' + 
    mandors.map(m => `<option value="${m.id}">⭐ Mandor: ${escapeHtml(m.name)} (${escapeHtml(m.specialist)})</option>`).join('');
}

function toggleMandorStar() {
  state.formIsMandor = !state.formIsMandor;
  updateMandorStarUI();
}

function updateMandorStarUI() {
  const btn = document.getElementById('btn-toggle-mandor-star');
  const icon = document.getElementById('star-icon');
  const text = document.getElementById('star-text');
  const groupPembina = document.getElementById('group-mandor-pembina');

  if (state.formIsMandor) {
    btn?.classList.add('active');
    if (icon) icon.innerText = '⭐';
    if (text) text.innerText = 'Status: Mandor';
    if (groupPembina) groupPembina.style.display = 'none';
  } else {
    btn?.classList.remove('active');
    if (icon) icon.innerText = '☆';
    if (text) text.innerText = 'Mandor?';
    if (groupPembina) groupPembina.style.display = 'block';
  }
}

// 4. Attendance Data (URUTAN DETERMINISTIK & STABIL SAAT GANTI TANGGAL)
async function loadAttendance(dateStr) {
  try {
    const res = await fetchApi(`/api/attendance?date=${dateStr}`);
    const data = await res.json();
    state.attendanceSession = data.session;
    state.attendanceRecords = data.records;

    state.attendanceRecords.forEach(r => {
      if (!r.status) r.status = 'hadir';
      if (r.overtime_hours === null || r.overtime_hours === undefined) {
        if (r.status === 'hadir') r.overtime_hours = 2;
        else if (r.status === 'setengah_hari') r.overtime_hours = 1;
        else r.overtime_hours = 0;
      }
      if (r.extra_days === null || r.extra_days === undefined) {
        r.extra_days = 0;
      }
    });

    renderAttendanceTablesGrouped();
    updateAttendanceSessionBanner();
  } catch (err) {
    console.error('Error loading attendance', err);
  }
}

function updateAttendanceSessionBanner() {
  const infoEl = document.getElementById('attendance-session-info');
  const btnProcess = document.getElementById('btn-process-text');
  const btnProcessContainer = document.getElementById('btn-process-attendance');
  if (!infoEl) return;

  if (state.attendanceSession && state.attendanceSession.submitter_name) {
    let text = `Absensi hari ini telah diproses oleh: <strong>${escapeHtml(state.attendanceSession.submitter_name)}</strong>`;
    if (state.attendanceSession.corrector_names && state.attendanceSession.corrector_names.trim()) {
      text += ` <span style="color: var(--border); margin: 0 4px;">|</span> Dikoreksi oleh: <strong style="color: var(--warning);">${escapeHtml(state.attendanceSession.corrector_names)}</strong>`;
    }
    infoEl.innerHTML = `
      <i data-feather="check-circle" style="color: var(--success); width: 15px; height: 15px; vertical-align: middle; margin-right: 4px;"></i>
      <span>${text}</span>
    `;
    if (btnProcess) btnProcess.innerText = 'Koreksi / Simpan Ulang';
    if (btnProcessContainer) {
      btnProcessContainer.className = 'btn btn-primary btn-sm';
      btnProcessContainer.title = 'Koreksi atau simpan ulang data absensi hari ini';
    }
  } else {
    infoEl.innerHTML = `
      <i data-feather="clock" style="color: var(--text-muted); width: 15px; height: 15px; vertical-align: middle; margin-right: 4px;"></i>
      <span style="color: var(--text-muted);">Absensi hari ini belum diproses & dikunci</span>
    `;
    if (btnProcess) btnProcess.innerText = 'Proses Absen Hari Ini';
    if (btnProcessContainer) {
      btnProcessContainer.className = 'btn btn-primary btn-sm';
      btnProcessContainer.title = 'Proses dan kunci absensi hari ini';
    }
  }
  feather.replace();
}

// RENDER TABEL ABSENSI TERPISAH PER MANDOR SECARA KONSISTEN & STABIL
function renderAttendanceTablesGrouped() {
  const container = document.getElementById('attendance-mandor-groups-container');
  if (!container) return;

  if (state.attendanceRecords.length === 0) {
    container.innerHTML = `<div class="card" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Tidak ada data tukang. Silakan muat contoh tukang di menu Master Tukang.</div>`;
    return;
  }

  // Find all Mandors
  const mandorWorkers = state.attendanceRecords.filter(r => r.is_mandor === 1);
  const mandorIds = new Set(mandorWorkers.map(m => m.worker_id));

  const groups = [];

  mandorWorkers.forEach(mandor => {
    const members = state.attendanceRecords.filter(r => r.mandor_id === mandor.worker_id && r.worker_id !== mandor.worker_id);
    groups.push({
      mandorId: mandor.worker_id,
      mandorName: mandor.name,
      mandorSpec: mandor.specialist,
      mandorRecord: mandor,
      members: [mandor, ...members]
    });
  });

  const independentMembers = state.attendanceRecords.filter(r => !r.is_mandor && (!r.mandor_id || !mandorIds.has(r.mandor_id)));
  if (independentMembers.length > 0) {
    groups.push({
      mandorId: 999999,
      mandorName: 'Tukang Mandiri / Non-Grup',
      mandorSpec: 'Umum',
      mandorRecord: null,
      members: independentMembers
    });
  }

  container.innerHTML = groups.map(grp => {
    return `
      <div class="card" style="margin-bottom: 1.15rem; padding: 0.85rem 1rem;">
        <div class="card-header-flex" style="border-bottom: 1px solid var(--border); padding-bottom: 0.45rem; margin-bottom: 0.65rem;">
          <div>
            <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main);">
              ${grp.mandorRecord ? `⭐ Tim Mandor: ${escapeHtml(grp.mandorName)} (${escapeHtml(grp.mandorSpec)})` : escapeHtml(grp.mandorName)}
            </h3>
            <span style="font-size: 0.74rem; color: var(--text-muted);">${grp.members.length} Orang Tukang</span>
          </div>
        </div>

        <div class="table-responsive" style="margin-bottom: 0;">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 30px;">No</th>
                <th>Nama Tukang</th>
                <th>Spesialis</th>
                <th style="text-align: center;">Status Kehadiran</th>
                <th>Pekerjaan Hari Ini</th>
                <th style="text-align: center;">Lembur (Jam/Hari)</th>
                <th style="text-align: center;">Kasbon</th>
              </tr>
            </thead>
            <tbody>
              ${grp.members.map((r, idx) => {
                const currentStatus = r.status || 'hadir';
                const isSick = currentStatus === 'sakit';
                const sickText = (isSick && r.sick_allowance > 0) ? ` (Obat: ${formatRupiah(r.sick_allowance)})` : '';
                
                let otBadgeText = `${r.overtime_hours || 0} Jam`;
                let otSpecialClass = '';
                if (r.extra_days > 0) {
                  otBadgeText = `+${r.extra_days} Hari Upah`;
                  otSpecialClass = 'special';
                } else if (r.overtime_note) {
                  otBadgeText = r.overtime_note;
                  otSpecialClass = 'special';
                }

                return `
                  <tr data-worker-id="${r.worker_id}">
                    <td style="color: var(--text-muted);">${idx + 1}</td>
                    <td>
                      <strong>${escapeHtml(r.name)}</strong>
                      ${r.is_mandor ? `<span class="mandor-badge-star" style="margin-left: 4px;">Mandor</span>` : ''}
                      ${isSick && r.sick_allowance > 0 ? `<div style="font-size: 0.7rem; color: #3b82f6;">+ Bantuan Obat: ${formatRupiah(r.sick_allowance)}</div>` : ''}
                    </td>
                    <td><span class="specialist-pill">${escapeHtml(r.specialist)}</span></td>
                    <td style="text-align: center;">
                      <div class="status-pill-group">
                        <button class="status-btn ${currentStatus === 'hadir' ? 'active hadir' : ''}" onclick="setWorkerStatusPatent(${r.worker_id}, 'hadir')">Hadir</button>
                        <button class="status-btn ${currentStatus === 'setengah_hari' ? 'active setengah_hari' : ''}" onclick="setWorkerStatusPatent(${r.worker_id}, 'setengah_hari')">½ Hari</button>
                        <button class="status-btn ${currentStatus === 'sakit' ? 'active sakit' : ''}" onclick="openSickModal(${r.worker_id}, '${escapeHtml(r.name)}')">Sakit${sickText}</button>
                        <button class="status-btn ${currentStatus === 'tidak_hadir' ? 'active tidak_hadir' : ''}" onclick="setWorkerStatusPatent(${r.worker_id}, 'tidak_hadir')">Absen</button>
                      </div>
                    </td>
                    <td>
                      <input type="text" class="text-input job-input" 
                             value="${escapeHtml(r.job_description || '')}" 
                             placeholder="Pekerjaan hari ini..."
                             onfocus="this.select()"
                             onchange="updateWorkerJob(${r.worker_id}, this.value)"
                             onkeydown="handleJobInputKeydown(event, this, ${r.worker_id})"
                             style="font-size: 0.78rem; padding: 0.3rem 0.5rem;">
                    </td>
                    <td style="text-align: center;">
                      <button class="btn-overtime-badge ${otSpecialClass}" onclick="openOvertimeOptionsModal(${r.worker_id}, '${escapeHtml(r.name)}')">
                        <i data-feather="clock" style="width: 12px; height: 12px;"></i>
                        <span>${otBadgeText}</span>
                      </button>
                    </td>
                    <td style="text-align: center;">
                      <button class="btn btn-outline btn-sm" onclick="openLoanModal(${r.worker_id}, '${escapeHtml(r.name)}')" title="Catat Kasbon">
                        <i data-feather="credit-card" style="width: 12px;"></i> Kasbon
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  feather.replace();
}

// LOGIKA LEMBUR PATEN OTOMATIS & PERBAIKAN STATE MUTATION
function setWorkerStatusPatent(workerId, status) {
  const wid = parseInt(workerId, 10);
  const record = state.attendanceRecords.find(r => parseInt(r.worker_id, 10) === wid);
  if (!record) return;

  record.status = status;
  record.extra_days = 0;
  record.overtime_note = '';

  if (status === 'hadir') {
    record.overtime_hours = 2; // Paten Hadir = 2 Jam
  } else if (status === 'setengah_hari') {
    record.overtime_hours = 1; // Paten 1/2 Hari = 1 Jam
  } else {
    record.overtime_hours = 0; // Paten Sakit / Absen = 0 Jam
  }

  if (status !== 'sakit') {
    record.sick_allowance = 0;
  }

  renderAttendanceTablesGrouped();
}

function openOvertimeOptionsModal(workerId, workerName) {
  state.pendingOvertimeWorkerId = parseInt(workerId, 10);
  const record = state.attendanceRecords.find(r => parseInt(r.worker_id, 10) === state.pendingOvertimeWorkerId);
  document.getElementById('modal-ot-worker-name').innerText = workerName;
  
  const radios = document.querySelectorAll('input[name="ot-choice"]');
  const groupCustom = document.getElementById('group-custom-ot-hours');
  const inputCustom = document.getElementById('input-custom-ot-hours');

  if (record && record.extra_days === 1) {
    radios[1].checked = true;
    if (groupCustom) groupCustom.style.display = 'none';
  } else if (record && record.extra_days === 2) {
    radios[2].checked = true;
    if (groupCustom) groupCustom.style.display = 'none';
  } else if (record && record.overtime_hours > 2) {
    radios[3].checked = true;
    if (groupCustom) groupCustom.style.display = 'block';
    if (inputCustom) inputCustom.value = record.overtime_hours;
  } else {
    radios[0].checked = true;
    if (groupCustom) groupCustom.style.display = 'none';
  }

  document.getElementById('modal-overtime-options').classList.add('open');
}

function saveOvertimeOptions() {
  if (!state.pendingOvertimeWorkerId) return;
  const wid = state.pendingOvertimeWorkerId;
  const record = state.attendanceRecords.find(r => parseInt(r.worker_id, 10) === wid);
  if (!record) return;

  const choice = document.querySelector('input[name="ot-choice"]:checked')?.value || 'normal';

  if (choice === 'normal') {
    record.extra_days = 0;
    record.overtime_note = '';
    record.overtime_hours = record.status === 'hadir' ? 2 : (record.status === 'setengah_hari' ? 1 : 0);
  } else if (choice === '1_day') {
    record.extra_days = 1;
    record.overtime_hours = 0;
    record.overtime_note = '+1 Hari (-2 Jam)';
  } else if (choice === '2_day') {
    record.extra_days = 2;
    record.overtime_hours = 0;
    record.overtime_note = '+2 Hari';
  } else if (choice === 'custom_hours') {
    const val = parseFloat(document.getElementById('input-custom-ot-hours').value) || 0;
    record.extra_days = 0;
    record.overtime_hours = val;
    record.overtime_note = `${val} Jam`;
  }

  document.getElementById('modal-overtime-options').classList.remove('open');
  renderAttendanceTablesGrouped();
  showToast('Pengaturan lembur berhasil diterapkan', 'success');
}

function openSickModal(workerId, workerName) {
  state.pendingSickWorkerId = parseInt(workerId, 10);
  const record = state.attendanceRecords.find(r => parseInt(r.worker_id, 10) === state.pendingSickWorkerId);
  document.getElementById('modal-sick-worker-name').innerText = workerName;
  document.getElementById('input-sick-amount').value = (record && record.sick_allowance) ? record.sick_allowance : 50000;
  document.getElementById('modal-sick-allowance').classList.add('open');
}

function saveSickAllowance() {
  const amount = parseFloat(document.getElementById('input-sick-amount').value) || 0;
  if (state.pendingSickWorkerId) {
    const record = state.attendanceRecords.find(r => parseInt(r.worker_id, 10) === state.pendingSickWorkerId);
    if (record) {
      record.status = 'sakit';
      record.sick_allowance = amount;
      record.overtime_hours = 0;
      record.extra_days = 0;
      record.overtime_note = '';
    }
  }
  document.getElementById('modal-sick-allowance').classList.remove('open');
  renderAttendanceTablesGrouped();
}

function updateWorkerJob(workerId, jobText) {
  const wid = parseInt(workerId, 10);
  const currentRecord = state.attendanceRecords.find(r => parseInt(r.worker_id, 10) === wid);
  if (!currentRecord) return;
  currentRecord.job_description = jobText;

  if (currentRecord.is_mandor && jobText.trim() !== '') {
    state.attendanceRecords.forEach(rec => {
      if (parseInt(rec.mandor_id, 10) === currentRecord.worker_id) {
        if (!rec.job_description || rec.job_description.trim() === '') {
          rec.job_description = jobText;
        }
      }
    });
    renderAttendanceTablesGrouped();
    showToast(`Pekerjaan otomatis diterapkan ke tim ${currentRecord.name}`, 'info');
  }
}

// Navigasi cepat kolom isi pekerjaan: Enter / Panah Bawah loncat ke baris bawahnya
function handleJobInputKeydown(event, inputEl, workerId) {
  if (event.key === 'Enter') {
    event.preventDefault();
    const allInputs = Array.from(document.querySelectorAll('.job-input'));
    const currentIndex = allInputs.indexOf(inputEl);
    const nextIndex = currentIndex + 1;

    // Simpan nilai pekerjaan saat ini
    updateWorkerJob(workerId, inputEl.value);

    // Fokus ke baris berikutnya (jeda untuk mengantisipasi re-render tim mandor)
    setTimeout(() => {
      const freshInputs = Array.from(document.querySelectorAll('.job-input'));
      if (nextIndex < freshInputs.length) {
        freshInputs[nextIndex].focus();
        freshInputs[nextIndex].select();
      }
    }, 40);
  } else if (event.key === 'ArrowDown') {
    const allInputs = Array.from(document.querySelectorAll('.job-input'));
    const currentIndex = allInputs.indexOf(inputEl);
    if (currentIndex + 1 < allInputs.length) {
      event.preventDefault();
      updateWorkerJob(workerId, inputEl.value);
      allInputs[currentIndex + 1].focus();
      allInputs[currentIndex + 1].select();
    }
  } else if (event.key === 'ArrowUp') {
    const allInputs = Array.from(document.querySelectorAll('.job-input'));
    const currentIndex = allInputs.indexOf(inputEl);
    if (currentIndex > 0) {
      event.preventDefault();
      updateWorkerJob(workerId, inputEl.value);
      allInputs[currentIndex - 1].focus();
      allInputs[currentIndex - 1].select();
    }
  }
}

// Modal Proses Absen & Koreksi
function openProcessAttendanceModal() {
  const modal = document.getElementById('modal-process-attendance');
  const title = document.getElementById('modal-process-title');
  const desc = document.getElementById('modal-process-desc');
  const lbl = document.getElementById('lbl-submitter-name');
  const input = document.getElementById('input-submitter-name');

  const isCorrection = Boolean(state.attendanceSession && state.attendanceSession.submitter_name);
  if (isCorrection) {
    title.innerText = 'Koreksi Absensi Hari Ini';
    desc.innerText = `Absen awal diproses oleh ${state.attendanceSession.submitter_name}. Masukkan nama pengoreksi:`;
    lbl.innerText = 'Nama Pengoreksi (Wajib diisi):';
    input.placeholder = 'Nama Anda (pengoreksi)';
    input.value = '';
  } else {
    title.innerText = 'Konfirmasi Proses Absensi';
    desc.innerText = 'Harap cantumkan nama lengkap Anda sebagai penanggung jawab absensi hari ini.';
    lbl.innerText = 'Nama Pengabsen (Wajib diisi):';
    input.placeholder = 'Contoh: Mandor Budi / Admin Proyek';
    input.value = '';
  }

  modal.classList.add('open');
  setTimeout(() => input?.focus(), 80);
}

async function submitProcessAttendance() {
  const input = document.getElementById('input-submitter-name');
  const name = input.value.trim();
  if (!name) {
    alert('Nama wajib diisi sebelum memproses!');
    input.focus();
    return;
  }

  try {
    const payload = {
      date: state.currentDate,
      submitter_name: name,
      records: state.attendanceRecords.map(r => ({
        worker_id: r.worker_id,
        status: r.status || 'hadir',
        sick_allowance: r.sick_allowance || 0,
        job_description: r.job_description || '',
        overtime_hours: r.overtime_hours || 0,
        extra_days: r.extra_days || 0,
        overtime_note: r.overtime_note || ''
      }))
    };

    const res = await fetchApi('/api/attendance/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menyimpan absensi');

    document.getElementById('modal-process-attendance').classList.remove('open');
    showToast('Absensi berhasil diproses dan disimpan!', 'success');
    await loadAttendance(state.currentDate);
    await loadDashboardData();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// 5. Materials Management: HEADER SORTING & KODE WARNA TRANSPARAN
async function loadMaterials() {
  try {
    const res = await fetchApi('/api/materials');
    state.materials = await res.json();
    renderMaterialsTable();
  } catch (err) {
    console.error('Error loading materials', err);
  }
}

function renderMaterialsTable() {
  const tbody = document.getElementById('materials-tbody');
  if (!tbody) return;

  let filtered = state.selectedCategory === 'ALL'
    ? [...state.materials]
    : state.materials.filter(m => m.category === state.selectedCategory);

  // Sorting (dimulai dari kategori secara teratur, kemudian sekunder nama)
  const catOrder = { 'struktur': 1, 'arsitektur': 2, 'mep': 3, 'inventaris kantor': 4, 'inventaris': 4 };
  const { key, dir } = state.materialSort;
  filtered.sort((a, b) => {
    let valA = a[key];
    let valB = b[key];
    if (key === 'category') {
      const ordA = catOrder[(valA || '').toLowerCase()] || 99;
      const ordB = catOrder[(valB || '').toLowerCase()] || 99;
      if (ordA !== ordB) return dir === 'asc' ? ordA - ordB : ordB - ordA;
    } else {
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();
      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
    }
    // Secondary sort by name
    const nameA = (a.name || '').toLowerCase();
    const nameB = (b.name || '').toLowerCase();
    return nameA.localeCompare(nameB);
  });

  // Update header sort icons
  document.querySelectorAll('#materials-table th.sortable-th').forEach(th => {
    const sortKey = th.getAttribute('data-sort-key');
    const icon = th.querySelector('.sort-icon');
    if (sortKey === key) {
      th.classList.add('active-sort');
      if (icon) icon.innerText = dir === 'asc' ? '▲' : '▼';
    } else {
      th.classList.remove('active-sort');
      if (icon) icon.innerText = '⇅';
    }
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 1.25rem;">Tidak ada material pada kategori ini.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((m, idx) => {
    const isLow = m.min_stock > 0 && m.stock_today <= m.min_stock;
    const statusBadge = isLow 
      ? `<span class="specialist-pill" style="color: var(--danger); background: var(--danger-light); font-size: 0.72rem; font-weight: 700;">Stok Menipis</span>`
      : `<span class="specialist-pill" style="color: var(--success); background: var(--success-light); font-size: 0.72rem;">Aman</span>`;

    // Warna transparan & ambigu tiap kategori:
    let catRowClass = '';
    const catLow = (m.category || '').toLowerCase();
    if (catLow.includes('struktur')) catRowClass = 'cat-row-struktur';
    else if (catLow.includes('arsitektur')) catRowClass = 'cat-row-arsitektur';
    else if (catLow.includes('mep')) catRowClass = 'cat-row-mep';
    else if (catLow.includes('kantor') || catLow.includes('inventaris')) catRowClass = 'cat-row-inventaris';

    return `
      <tr class="${catRowClass}" data-id="${m.id}">
        <td style="color: var(--text-muted);">${idx + 1}</td>
        <td><span class="specialist-pill" style="font-size: 0.72rem;">${escapeHtml(m.category)}</span></td>
        <td><strong>${escapeHtml(m.name)}</strong></td>
        <td style="text-align: right; font-weight: 500;">${m.stock_yesterday}</td>
        <td style="text-align: center;">
          <input type="number" class="table-input mat-in-input" value="${m.in_today}" min="0" step="any"
                 data-idx="${idx}" data-id="${m.id}"
                 style="color: var(--success); font-weight: 600;"
                 onfocus="this.select()"
                 onchange="updateMaterialQty(${m.id}, 'in_today', this.value)"
                 onkeydown="handleMaterialKeydown(event, this, 'in', ${idx})">
        </td>
        <td style="text-align: center;">
          <input type="number" class="table-input mat-out-input" value="${m.out_today}" min="0" step="any"
                 data-idx="${idx}" data-id="${m.id}"
                 style="color: var(--danger); font-weight: 600;"
                 onfocus="this.select()"
                 onchange="updateMaterialQty(${m.id}, 'out_today', this.value)"
                 onkeydown="handleMaterialKeydown(event, this, 'out', ${idx})">
        </td>
        <td class="mat-stock-today" style="text-align: right; font-weight: 700; font-size: 0.92rem; ${isLow ? 'color: var(--danger);' : ''}">
          ${m.stock_today}
        </td>
        <td style="text-align: center; color: var(--text-muted); font-weight: 600;">${escapeHtml(m.unit)}</td>
        <td class="mat-status-cell" style="text-align: center;">${statusBadge}</td>
        <td style="text-align: center;">
          <div style="display: inline-flex; gap: 0.25rem;">
            <button class="btn btn-outline btn-sm" onclick="openMaterialModal(${m.id})" title="Edit Barang" tabindex="-1"><i data-feather="edit-2" style="width: 12px;"></i></button>
            <button class="btn btn-outline btn-sm" style="color: var(--danger);" onclick="deleteMaterial(${m.id}, '${escapeHtml(m.name)}')" title="Hapus" tabindex="-1"><i data-feather="trash-2" style="width: 12px;"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  feather.replace();
}

// Navigasi cepat keyboard stok material:
// Masuk -> [Tab] -> Keluar -> [Tab] -> Masuk baris bawahnya
function handleMaterialKeydown(event, inputEl, type, idx) {
  const rowIdx = parseInt(idx, 10);
  
  if (event.key === 'Tab') {
    if (!event.shiftKey) {
      // TAB MAJU: Masuk -> Keluar -> Masuk baris bawahnya
      if (type === 'in') {
        event.preventDefault();
        inputEl.blur();
        const nextTarget = document.querySelector(`.mat-out-input[data-idx="${rowIdx}"]`);
        if (nextTarget) {
          nextTarget.focus();
          nextTarget.select();
        }
      } else if (type === 'out') {
        const nextTarget = document.querySelector(`.mat-in-input[data-idx="${rowIdx + 1}"]`);
        if (nextTarget) {
          event.preventDefault();
          inputEl.blur();
          nextTarget.focus();
          nextTarget.select();
        }
      }
    } else {
      // SHIFT + TAB MUNDUR: Keluar -> Masuk -> Keluar baris atasnya
      if (type === 'out') {
        event.preventDefault();
        inputEl.blur();
        const prevTarget = document.querySelector(`.mat-in-input[data-idx="${rowIdx}"]`);
        if (prevTarget) {
          prevTarget.focus();
          prevTarget.select();
        }
      } else if (type === 'in' && rowIdx > 0) {
        const prevTarget = document.querySelector(`.mat-out-input[data-idx="${rowIdx - 1}"]`);
        if (prevTarget) {
          event.preventDefault();
          inputEl.blur();
          prevTarget.focus();
          prevTarget.select();
        }
      }
    }
  } else if (event.key === 'Enter' || event.key === 'ArrowDown') {
    // ENTER / PANAH BAWAH: Loncat ke kolom yang sama pada baris bawahnya
    event.preventDefault();
    inputEl.blur();
    const targetSelector = type === 'in' 
      ? `.mat-in-input[data-idx="${rowIdx + 1}"]` 
      : `.mat-out-input[data-idx="${rowIdx + 1}"]`;
    const nextTarget = document.querySelector(targetSelector);
    if (nextTarget) {
      nextTarget.focus();
      nextTarget.select();
    }
  } else if (event.key === 'ArrowUp' && rowIdx > 0) {
    // PANAH ATAS: Loncat ke baris atasnya
    event.preventDefault();
    inputEl.blur();
    const targetSelector = type === 'in' 
      ? `.mat-in-input[data-idx="${rowIdx - 1}"]` 
      : `.mat-out-input[data-idx="${rowIdx - 1}"]`;
    const prevTarget = document.querySelector(targetSelector);
    if (prevTarget) {
      prevTarget.focus();
      prevTarget.select();
    }
  }
}

async function updateMaterialQty(id, field, value) {
  const mat = state.materials.find(m => m.id === id);
  if (!mat) return;

  const valNum = parseFloat(value) || 0;
  if (mat[field] === valNum) {
    // Nilai tidak berubah, tidak perlu mengirim request ke server
    return;
  }

  // Tandai waktu update lokal agar event SSE tidak merebut fokus kursor
  state.lastMaterialEditTime = Date.now();
  mat[field] = valNum;

  const inVal = typeof mat.in_today === 'number' ? mat.in_today : (parseFloat(mat.in_today) || 0);
  const outVal = typeof mat.out_today === 'number' ? mat.out_today : (parseFloat(mat.out_today) || 0);
  const yestVal = typeof mat.stock_yesterday === 'number' ? mat.stock_yesterday : (parseFloat(mat.stock_yesterday) || 0);
  mat.stock_today = Number((yestVal + inVal - outVal).toFixed(2));

  // Perbarui nilai dan status stok di baris DOM seketika tanpa re-render tabel (agar navigasi Tab/Enter tidak terputus)
  const row = document.querySelector(`tr[data-id="${id}"]`);
  if (row) {
    const isLow = mat.min_stock > 0 && mat.stock_today <= mat.min_stock;
    const stockCell = row.querySelector('.mat-stock-today');
    const statusCell = row.querySelector('.mat-status-cell');
    if (stockCell) {
      stockCell.innerText = mat.stock_today;
      stockCell.style.color = isLow ? 'var(--danger)' : '';
    }
    if (statusCell) {
      statusCell.innerHTML = isLow 
        ? `<span class="specialist-pill" style="color: var(--danger); background: var(--danger-light); font-size: 0.72rem; font-weight: 700;">Stok Menipis</span>`
        : `<span class="specialist-pill" style="color: var(--success); background: var(--success-light); font-size: 0.72rem;">Aman</span>`;
    }
  }

  const payload = {
    in_today: mat.in_today,
    out_today: mat.out_today
  };

  try {
    const res = await fetchApi(`/api/materials/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Gagal update stok material');
    loadDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 6. Loans (Kasbon) - AMAN DENGAN ID VALID
function openLoanModal(workerId, workerName) {
  state.pendingLoanWorkerId = parseInt(workerId, 10);
  document.getElementById('modal-loan-worker-name').innerText = workerName;
  const idBadge = document.getElementById('modal-loan-worker-id-badge');
  if (idBadge) idBadge.innerText = `(ID: ${state.pendingLoanWorkerId})`;
  document.getElementById('input-loan-amount').value = '';
  document.getElementById('input-loan-weekly-term').value = '';
  document.getElementById('input-loan-note').value = '';
  document.getElementById('modal-loan').classList.add('open');
  document.getElementById('input-loan-amount').focus();
}

async function submitWorkerLoan() {
  const amount = parseFloat(document.getElementById('input-loan-amount').value);
  const term = parseFloat(document.getElementById('input-loan-weekly-term').value);
  const note = document.getElementById('input-loan-note').value.trim();

  if (!state.pendingLoanWorkerId || isNaN(state.pendingLoanWorkerId)) {
    alert('ID Tukang tidak valid. Harap buka kembali modal kasbon.');
    return;
  }

  if (!amount || amount <= 0 || !term || term <= 0) {
    alert('Harap isi nominal kasbon dan termin per minggu dengan angka valid (> 0)!');
    return;
  }

  try {
    const res = await fetchApi('/api/loans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worker_id: state.pendingLoanWorkerId,
        total_amount: amount,
        weekly_term: term,
        note
      })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal memproses kasbon');
    
    document.getElementById('modal-loan').classList.remove('open');
    showToast(result.message || 'Kasbon berhasil diproses!', 'success');
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// 7. Worker Form Modal
function openWorkerModal(id = null) {
  const title = document.getElementById('modal-worker-title');
  const form = document.getElementById('form-worker');
  const editIdInput = document.getElementById('worker-edit-id');
  form.reset();

  if (id) {
    const w = state.workers.find(item => item.id === id);
    if (!w) return;
    title.innerText = 'Edit Data Tukang';
    editIdInput.value = w.id;
    document.getElementById('worker-name').value = w.name;
    document.getElementById('worker-specialist').value = w.specialist;
    document.getElementById('worker-mandor-id').value = w.mandor_id || '';
    document.getElementById('worker-daily-wage').value = w.daily_wage;
    document.getElementById('worker-hourly-rate').value = w.hourly_overtime_rate;
    state.formIsMandor = Boolean(w.is_mandor);
  } else {
    title.innerText = 'Tambah Tukang Baru';
    editIdInput.value = '';
    document.getElementById('worker-daily-wage').value = 180000;
    document.getElementById('worker-hourly-rate').value = 22500;
    state.formIsMandor = false;
  }

  updateMandorStarUI();
  document.getElementById('modal-worker-form').classList.add('open');
}

async function submitWorkerForm() {
  const editId = document.getElementById('worker-edit-id').value;
  const name = document.getElementById('worker-name').value.trim();
  const specialist = document.getElementById('worker-specialist').value;
  const mandorId = document.getElementById('worker-mandor-id').value;
  const dailyWage = parseFloat(document.getElementById('worker-daily-wage').value) || 0;
  const hourlyRate = parseFloat(document.getElementById('worker-hourly-rate').value) || 0;

  if (!name) {
    alert('Nama tukang wajib diisi!');
    return;
  }

  const payload = {
    name,
    specialist,
    is_mandor: state.formIsMandor ? 1 : 0,
    mandor_id: state.formIsMandor ? null : (mandorId ? parseInt(mandorId, 10) : null),
    daily_wage: dailyWage,
    hourly_overtime_rate: hourlyRate
  };

  try {
    let res;
    if (editId) {
      res = await fetchApi(`/api/workers/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetchApi('/api/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) throw new Error('Gagal menyimpan data tukang');
    document.getElementById('modal-worker-form').classList.remove('open');
    showToast('Data tukang berhasil disimpan!', 'success');
    await loadWorkers();
    await loadAttendance(state.currentDate);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function archiveWorker(id, name) {
  if (!confirm(`Pindahkan tukang "${name}" ke Arsip Tukang Lama?`)) return;
  try {
    const res = await fetchApi(`/api/workers/${id}/archive`, { method: 'POST' });
    if (!res.ok) throw new Error('Gagal memindahkan ke arsip');
    showToast('Tukang dipindahkan ke Arsip Tukang Lama', 'info');
    await loadWorkers();
    await loadAttendance(state.currentDate);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function seedWorkers10() {
  if (!confirm('Muat 10 data contoh tukang dengan status Mandor & pembagian tim?')) return;
  try {
    const res = await fetchApi('/api/seed/workers', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || '10 Tukang Berhasil Dimuat!', 'success');
    await loadWorkers();
    await loadAttendance(state.currentDate);
    await loadDashboardData();
  } catch (err) {
    alert('Gagal: ' + err.message);
  }
}

async function seedMaterials10() {
  if (!confirm('Muat 10 data contoh material proyek dengan jumlah berbeda-beda?')) return;
  try {
    const res = await fetchApi('/api/seed/materials', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || '10 Material Berhasil Dimuat!', 'success');
    await loadMaterials();
    await loadDashboardData();
  } catch (err) {
    alert('Gagal: ' + err.message);
  }
}

// 8. PIN Security & Wage Unlocking
function promptAdminPin(actionCallback, desc = 'Masukkan PIN 4 digit untuk membuka data ini.') {
  state.pendingPinAction = actionCallback;
  document.getElementById('modal-pin-desc').innerText = desc;
  document.getElementById('input-modal-pin').value = '';
  document.getElementById('modal-pin-prompt').classList.add('open');
  document.getElementById('input-modal-pin').focus();
}

async function submitModalPin() {
  const pin = document.getElementById('input-modal-pin').value;
  try {
    const res = await fetchApi('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (res.ok && data.valid) {
      document.getElementById('modal-pin-prompt').classList.remove('open');
      if (typeof state.pendingPinAction === 'function') {
        state.pendingPinAction();
      }
    } else {
      alert(data.message || 'PIN Admin Salah!');
    }
  } catch (err) {
    alert('Gagal verifikasi PIN: ' + err.message);
  }
}

function handleUnlockWages() {
  if (state.isWagesUnlocked) {
    state.isWagesUnlocked = false;
    document.getElementById('btn-unlock-wages-text').innerText = 'Buka Rincian Upah';
    document.getElementById('icon-wage-lock').setAttribute('data-feather', 'lock');
    renderWorkersTable();
    showToast('Rincian upah kembali disembunyikan', 'info');
    return;
  }

  promptAdminPin(() => {
    state.isWagesUnlocked = true;
    document.getElementById('btn-unlock-wages-text').innerText = 'Sembunyikan Upah';
    document.getElementById('icon-wage-lock').setAttribute('data-feather', 'unlock');
    renderWorkersTable();
    showToast('Rincian upah berhasil dibuka!', 'success');
  }, 'Upah bersifat rahasia. Masukkan PIN Admin untuk menampilkan nominal.');
}

function handleOpenArchive() {
  promptAdminPin(async () => {
    await loadArchivedWorkers();
    document.getElementById('modal-archived-workers').classList.add('open');
  }, 'Masukkan PIN Admin untuk mengakses Arsip Tukang Lama.');
}

async function loadArchivedWorkers() {
  try {
    const res = await fetchApi('/api/workers/archived');
    state.archivedWorkers = await res.json();
    const tbody = document.getElementById('archived-workers-tbody');
    if (!tbody) return;

    if (state.archivedWorkers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.25rem;">Tidak ada tukang di dalam arsip.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.archivedWorkers.map(w => `
      <tr>
        <td><strong>${escapeHtml(w.name)}</strong></td>
        <td><span class="specialist-pill">${escapeHtml(w.specialist)}</span></td>
        <td style="font-size: 0.74rem; color: var(--text-muted);">${w.archived_at ? formatShortDate(w.archived_at) : '-'}</td>
        <td style="text-align: center;">
          <button class="btn btn-outline btn-sm" onclick="restoreWorker(${w.id}, '${escapeHtml(w.name)}')" title="Kembalikan ke data aktif">
            <i data-feather="corner-up-left" style="width: 12px;"></i> Kembalikan
          </button>
        </td>
      </tr>
    `).join('');
    feather.replace();
  } catch (err) {
    console.error('Error loading archive', err);
  }
}

async function restoreWorker(id, name) {
  try {
    const res = await fetchApi(`/api/workers/${id}/restore`, { method: 'POST' });
    if (!res.ok) throw new Error('Gagal mengembalikan tukang');
    showToast(`Tukang "${name}" telah diaktifkan kembali!`, 'success');
    await loadArchivedWorkers();
    await loadWorkers();
    await loadAttendance(state.currentDate);
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// 9. Weekly Payroll (MANDOR GABUNG DENGAN ANGGOTANYA DALAM 1 TABEL TIM)
async function verifyPayrollPin() {
  const pinInput = document.getElementById('input-payroll-pin');
  const pin = pinInput?.value || '';
  if (!pin) {
    showToast('Ketik PIN Admin terlebih dahulu', 'error');
    pinInput?.focus();
    return;
  }
  try {
    const res = await fetchApi('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (res.ok && data.valid) {
      state.isPayrollUnlocked = true;
      document.getElementById('payroll-locked-view').style.display = 'none';
      document.getElementById('payroll-unlocked-view').style.display = 'block';
      await loadWeeklyPayroll();
      showToast('Rekap upah berhasil dibuka!', 'success');
    } else {
      showToast(data.message || 'PIN Admin Salah!', 'error');
      if (pinInput) {
        pinInput.value = '';
        pinInput.focus();
      }
    }
  } catch (err) {
    showToast('Gagal memverifikasi: ' + err.message, 'error');
    pinInput?.focus();
  }
}

async function loadWeeklyPayroll() {
  const curr = new Date(state.currentDate + 'T00:00:00');
  const day = curr.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
  const sunday = new Date(curr);
  sunday.setDate(curr.getDate() - day);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);

  const startStr = formatDateStr(sunday);
  const endStr = formatDateStr(saturday);

  const rangeEl = document.getElementById('payroll-range-text');
  if (rangeEl) {
    rangeEl.innerText = `Periode: Minggu (${startStr}) s/d Sabtu (${endStr})`;
  }

  try {
    const res = await fetchApi(`/api/payroll/weekly?startDate=${startStr}&endDate=${endStr}`);
    state.payrollData = await res.json();
    renderPayrollGroups();
  } catch (err) {
    console.error('Error loading payroll', err);
  }
}

function renderPayrollGroups() {
  const container = document.getElementById('payroll-mandor-groups');
  if (!container || !state.payrollData) return;

  const data = state.payrollData;
  const list = data.payrollList;
  const days = data.days || [];
  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const dayFullNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  // Grand Total di Paling Atas
  document.getElementById('payroll-grand-total-net').innerText = formatRupiah(data.totalNetAll);
  document.getElementById('payroll-grand-total-gross').innerText = formatRupiah(data.totalGrossAll);
  document.getElementById('payroll-grand-total-loan').innerText = data.totalLoanDeductionAll > 0 ? `-${formatRupiah(data.totalLoanDeductionAll)}` : 'Rp 0';

  if (list.length === 0) {
    container.innerHTML = `<div class="card" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Belum ada data tukang aktif.</div>`;
    return;
  }

  // Grouping: MANDOR MENYATU DENGAN TIMNYA DALAM SATU TABEL
  const mandors = list.filter(w => w.is_mandor === 1);
  const mandorIds = new Set(mandors.map(m => m.id));

  const groups = [];

  mandors.forEach(mandor => {
    const members = list.filter(w => w.mandor_id === mandor.id && w.id !== mandor.id);
    groups.push({
      groupName: `⭐ Tim Mandor: ${mandor.name} (${mandor.specialist})`,
      members: [mandor, ...members] // Mandor di baris pertama, lalu anak buahnya
    });
  });

  const independents = list.filter(w => !w.is_mandor && (!w.mandor_id || !mandorIds.has(w.mandor_id)));
  if (independents.length > 0) {
    groups.push({
      groupName: 'Tukang Mandiri / Non-Grup',
      members: independents
    });
  }

  // Legend Keterangan Warna Harian
  let html = `
    <div class="card" style="margin-bottom: 0.85rem; padding: 0.6rem 0.85rem; background: var(--bg-card-subtle);">
      <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; font-size: 0.75rem;">
        <span style="font-weight: 700; color: var(--text-main);">Keterangan Absensi Harian:</span>
        <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
          <span class="payroll-day-badge badge-hadir">H</span> <strong>Hadir</strong> (Hijau)
        </span>
        <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
          <span class="payroll-day-badge badge-setengah">½</span> <strong>Setengah Hari</strong> (Kuning)
        </span>
        <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
          <span class="payroll-day-badge badge-sakit">S</span> <strong>Sakit</strong> (Oren)
        </span>
        <span style="display: inline-flex; align-items: center; gap: 0.35rem;">
          <span class="payroll-day-badge badge-absen">A</span> <strong>Tidak Hadir</strong> (Merah)
        </span>
        <span style="display: inline-flex; align-items: center; gap: 0.35rem; color: var(--text-muted);">
          <span style="font-weight: 700; width: 25px; text-align: center;">-</span> Belum Diabsen
        </span>
      </div>
    </div>
  `;

  // Header 7 Hari: Minggu s/d Sabtu
  const dayHeadersHtml = days.map((dateStr, idx) => {
    const dNum = dateStr.slice(8);
    return `
      <th style="text-align: center; padding: 4px 2px; min-width: 36px;">
        <div style="font-weight: 700; font-size: 0.72rem;">${dayNames[idx]}</div>
        <div style="font-size: 0.65rem; color: var(--text-muted); font-weight: 500;">${dNum}</div>
      </th>
    `;
  }).join('');

  groups.forEach(grp => {
    const groupTotalNet = grp.members.reduce((sum, m) => sum + m.netWage, 0);
    const grpGross = grp.members.reduce((sum, m) => sum + (m.grossWage || 0), 0);
    const grpLoanDeduct = grp.members.reduce((sum, m) => sum + (m.loanDeductionThisWeek || 0), 0);
    const grpRemainingLoan = grp.members.reduce((sum, m) => sum + ((m.remainingLoan !== undefined ? m.remainingLoan : m.remainingLoanAfter) || 0), 0);

    html += `
      <div class="card" style="margin-bottom: 1.25rem; padding: 0.85rem 1rem;">
        <div class="card-header-flex" style="border-bottom: 1px solid var(--border); padding-bottom: 0.45rem; margin-bottom: 0.65rem;">
          <div>
            <h3 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main);">${escapeHtml(grp.groupName)}</h3>
            <span style="font-size: 0.74rem; color: var(--text-muted);">${grp.members.length} Orang Pekerja</span>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 0.72rem; color: var(--text-muted);">Total Diterima Tim</div>
            <div style="font-size: 1.05rem; font-weight: 700; color: var(--primary);">${formatRupiah(groupTotalNet)}</div>
          </div>
        </div>

        <div class="table-responsive" style="margin-bottom: 0;">
          <table class="data-table">
            <thead>
              <tr>
                <th style="min-width: 130px;">Nama</th>
                <th>Spesialis</th>
                ${dayHeadersHtml}
                <th style="text-align: center; min-width: 65px;">Ekstra</th>
                <th style="text-align: right; min-width: 85px;">Upah Kotor</th>
                <th style="text-align: right; min-width: 85px; color: var(--danger);">Potong Kasbon</th>
                <th style="text-align: right; min-width: 85px; color: var(--text-muted);">Sisa Kasbon <span style="font-size:0.65rem; font-weight:normal;">(Info)</span></th>
                <th style="text-align: right; min-width: 95px; color: var(--primary); font-weight: 700;">Upah Bersih</th>
              </tr>
            </thead>
            <tbody>
              ${grp.members.map(m => {
                const dayCellsHtml = days.map((dateStr, idx) => {
                  const dayRec = (m.dailyStatus && m.dailyStatus[dateStr]) ? m.dailyStatus[dateStr] : null;
                  const status = dayRec ? dayRec.status : null;
                  const dayName = dayFullNames[idx];

                  let badgeHtml = `<span style="color: var(--text-muted); opacity: 0.4;">-</span>`;
                  if (status === 'hadir') {
                    badgeHtml = `<span class="payroll-day-badge badge-hadir" title="${dayName} (${dateStr}): Hadir">H</span>`;
                  } else if (status === 'setengah_hari') {
                    badgeHtml = `<span class="payroll-day-badge badge-setengah" title="${dayName} (${dateStr}): Setengah Hari">½</span>`;
                  } else if (status === 'sakit') {
                    const sickMed = dayRec.sick_allowance > 0 ? ` (+Obat ${formatRupiah(dayRec.sick_allowance)})` : '';
                    badgeHtml = `<span class="payroll-day-badge badge-sakit" title="${dayName} (${dateStr}): Sakit${sickMed}">S</span>`;
                  } else if (status === 'tidak_hadir') {
                    badgeHtml = `<span class="payroll-day-badge badge-absen" title="${dayName} (${dateStr}): Tidak Hadir / Absen">A</span>`;
                  }

                  return `<td style="text-align: center; padding: 4px 2px;">${badgeHtml}</td>`;
                }).join('');

                const rem = (m.remainingLoan !== undefined ? m.remainingLoan : m.remainingLoanAfter) || 0;

                return `
                  <tr>
                    <td>
                      <strong>${escapeHtml(m.name)}</strong>
                      ${m.is_mandor ? `<span class="mandor-badge-star" style="margin-left: 4px;">Mandor</span>` : ''}
                    </td>
                    <td><span class="specialist-pill">${escapeHtml(m.specialist)}</span></td>
                    ${dayCellsHtml}
                    <td style="text-align: center;">
                      ${m.totalOvertimeHours} jam
                      ${m.totalExtraDays > 0 ? `<div style="font-size: 0.7rem; color: #1d4ed8; font-weight: 700;">+${m.totalExtraDays} Hari</div>` : ''}
                    </td>
                    <td style="text-align: right; font-weight: 500;">${formatRupiah(m.grossWage)}</td>
                    <td style="text-align: right; color: var(--danger); font-weight: 600;">
                      ${m.loanDeductionThisWeek > 0 ? `-${formatRupiah(m.loanDeductionThisWeek)}` : '-'}
                    </td>
                    <td style="text-align: right; color: var(--text-muted); font-size: 0.76rem;">
                      ${rem > 0 ? formatRupiah(rem) : '-'}
                    </td>
                    <td style="text-align: right; font-weight: 700; color: var(--primary);">
                      ${formatRupiah(m.netWage)}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr style="background: var(--bg-card-subtle); font-weight: 700;">
                <td colspan="10" style="text-align: right; text-transform: uppercase; font-size: 0.8rem; color: var(--text-muted); padding: 8px;">
                  Subtotal Tim:
                </td>
                <td style="text-align: right; font-weight: 600; padding: 8px;">${formatRupiah(grpGross)}</td>
                <td style="text-align: right; color: var(--danger); font-weight: 600; padding: 8px;">
                  ${grpLoanDeduct > 0 ? `-${formatRupiah(grpLoanDeduct)}` : '-'}
                </td>
                <td style="text-align: right; color: var(--text-muted); font-size: 0.76rem; padding: 8px;">
                  ${grpRemainingLoan > 0 ? formatRupiah(grpRemainingLoan) : '-'}
                </td>
                <td style="text-align: right; font-weight: 800; color: var(--primary); padding: 8px;">
                  ${formatRupiah(groupTotalNet)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  });

  const totalGrossAll = data.totalGrossAll || 0;
  const totalLoanDeductAll = data.totalLoanDeductionAll || 0;
  const totalNetAll = data.totalNetAll || 0;
  const totalRemainingLoanAll = list.reduce((sum, m) => sum + ((m.remainingLoan !== undefined ? m.remainingLoan : m.remainingLoanAfter) || 0), 0);

  html += `
    <div class="card" style="margin-top: 1rem; border: 2px solid var(--border); background: var(--bg-card);">
      <div style="font-weight: 800; font-size: 0.92rem; margin-bottom: 0.75rem; text-transform: uppercase; color: var(--text-main); display: flex; justify-content: space-between; align-items: center;">
        <span>Rekapitulasi Total Keseluruhan (Upah Bersih = Kotor - Potong Kasbon)</span>
        <span style="font-size: 1.15rem; color: var(--primary); font-weight: 800;">${formatRupiah(totalNetAll)}</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; font-size: 0.85rem;">
        <div style="background: var(--bg-card-subtle); padding: 8px 12px; border-radius: 6px;">
          <div style="color: var(--text-muted); font-size: 0.75rem;">Total Upah Kotor</div>
          <div style="font-weight: 700; color: var(--text-main); font-size: 1rem;">${formatRupiah(totalGrossAll)}</div>
        </div>
        <div style="background: var(--bg-card-subtle); padding: 8px 12px; border-radius: 6px;">
          <div style="color: var(--text-muted); font-size: 0.75rem;">Total Potong Kasbon</div>
          <div style="font-weight: 700; color: var(--danger); font-size: 1rem;">${totalLoanDeductAll > 0 ? `-${formatRupiah(totalLoanDeductAll)}` : 'Rp 0'}</div>
        </div>
        <div style="background: var(--bg-card-subtle); padding: 8px 12px; border-radius: 6px;">
          <div style="color: var(--text-muted); font-size: 0.75rem;">Total Sisa Kasbon <span style="font-size: 0.68rem; font-style: italic;">(Info Catatan)</span></div>
          <div style="font-weight: 700; color: #b45309; font-size: 1rem;">${formatRupiah(totalRemainingLoanAll)}</div>
        </div>
        <div style="background: rgba(2, 132, 199, 0.08); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(2, 132, 199, 0.3);">
          <div style="color: var(--primary); font-size: 0.75rem; font-weight: 600;">Total Upah Bersih Dibayar</div>
          <div style="font-weight: 800; color: var(--primary); font-size: 1.1rem;">${formatRupiah(totalNetAll)}</div>
        </div>
      </div>
      <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.75rem; font-style: italic;">
        * Catatan: Kolom <strong>Sisa Kasbon</strong> hanya bersifat catatan informasi saldo pinjaman pekerja dan <strong>tidak mempengaruhi rumus Grand Total Upah Bersih</strong> (Upah Bersih murni = Total Upah Kotor - Total Potong Kasbon).
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// 10. Material Modal
function openMaterialModal(id = null) {
  const title = document.getElementById('modal-material-title');
  const form = document.getElementById('form-material');
  const editIdInput = document.getElementById('material-edit-id');
  const initStockGroup = document.getElementById('group-material-init-stock');
  form.reset();

  if (id) {
    const m = state.materials.find(item => item.id === id);
    if (!m) return;
    title.innerText = 'Edit Material';
    editIdInput.value = m.id;
    document.getElementById('material-category').value = m.category;
    document.getElementById('material-name').value = m.name;
    document.getElementById('material-unit').value = m.unit;
    document.getElementById('material-min-stock').value = m.min_stock;
    if (initStockGroup) initStockGroup.style.display = 'none';
  } else {
    title.innerText = 'Tambah Material Baru';
    editIdInput.value = '';
    if (initStockGroup) initStockGroup.style.display = 'block';
    document.getElementById('material-stock-initial').value = 50;
    document.getElementById('material-min-stock').value = 15;
  }

  document.getElementById('modal-material-form').classList.add('open');
}

async function submitMaterialForm() {
  const editId = document.getElementById('material-edit-id').value;
  const category = document.getElementById('material-category').value;
  const name = document.getElementById('material-name').value.trim();
  const unit = document.getElementById('material-unit').value.trim();
  const stockInit = parseFloat(document.getElementById('material-stock-initial')?.value) || 0;
  const minStock = parseFloat(document.getElementById('material-min-stock').value) || 0;

  if (!name || !unit) {
    alert('Nama barang dan satuan wajib diisi!');
    return;
  }

  const payload = {
    category,
    name,
    unit,
    stock_initial: stockInit,
    min_stock: minStock
  };

  try {
    let res;
    if (editId) {
      res = await fetchApi(`/api/materials/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      res = await fetchApi('/api/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) throw new Error('Gagal menyimpan material');
    document.getElementById('modal-material-form').classList.remove('open');
    showToast('Material berhasil disimpan!', 'success');
    await loadMaterials();
    await loadDashboardData();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteMaterial(id, name) {
  if (!confirm(`Hapus material "${name}" dari sistem?`)) return;
  try {
    const res = await fetchApi(`/api/materials/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Gagal menghapus material');
    showToast('Material dihapus', 'info');
    await loadMaterials();
    await loadDashboardData();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// 11. Settings Form
async function submitSettingsForm(e) {
  e.preventDefault();
  const companyName = document.getElementById('setting-company-name').value.trim();
  const projectName = document.getElementById('setting-project-name').value.trim();
  const adminPin = document.getElementById('setting-admin-pin').value.trim();

  try {
    const res = await fetchApi('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, projectName, adminPin: adminPin || undefined })
    });
    if (!res.ok) throw new Error('Gagal menyimpan pengaturan');
    showToast('Pengaturan berhasil diperbarui!', 'success');
    await loadAppInfo();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// --- PDF DOWNLOAD & EXPORT DENGAN DESAIN RESMI & ELEGAN ---
async function generateAndDownloadPDF(htmlContent, filename, landscape = false) {
  showToast('Sedang membuat file PDF...', 'info');

  const opt = {
    margin: [8, 8, 8, 8],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      letterRendering: true,
      scrollY: 0,
      scrollX: 0
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' }
  };

  try {
    if (typeof html2pdf !== 'undefined') {
      // Mengirim htmlContent string langsung agar html2canvas mengukur layout & tinggi dokumen penuh
      await html2pdf().set(opt).from(htmlContent).save();
      showToast('File PDF berhasil diunduh!', 'success');
    } else {
      const printArea = document.getElementById('print-area');
      if (printArea) {
        printArea.innerHTML = htmlContent;
        window.print();
      }
    }
  } catch (err) {
    console.error('PDF error:', err);
    showToast('Gagal membuat PDF otomatis, membuka dialog cetak...', 'info');
    const printArea = document.getElementById('print-area');
    if (printArea) {
      printArea.innerHTML = htmlContent;
      window.print();
    }
  }
}

// 1. UNDUH PDF ABSENSI HARIAN
async function downloadAttendancePDF(date = null) {
  const targetDate = date || state.currentDate || formatDateStr(new Date());
  showToast('Memuat data absensi tukang...', 'info');

  let records = [];
  let session = null;

  try {
    const res = await fetchApi(`/api/attendance?date=${targetDate}`);
    if (res.ok) {
      const data = await res.json();
      records = data.records || [];
      session = data.session || null;
      if (targetDate === state.currentDate) {
        state.attendanceRecords = records;
        state.attendanceSession = session;
      }
    }
  } catch (e) {
    console.error('Fetch attendance error', e);
  }

  // Jika masih kosong, coba gunakan state lokal
  if (records.length === 0 && state.attendanceRecords && state.attendanceRecords.length > 0) {
    records = state.attendanceRecords;
    session = state.attendanceSession;
  }

  const company = state.appInfo.companyName || 'PT KARYA CIPTA KONSTRUKSI';
  const project = state.appInfo.projectName || 'Proyek Pembangunan Gedung & Hunian';

  const presentList = records.filter(r => r.status === 'hadir' || r.status === 'setengah_hari');
  const absentList = records.filter(r => r.status === 'tidak_hadir' || r.status === 'sakit');
  const sickList = records.filter(r => r.status === 'sakit');
  const halfDayList = records.filter(r => r.status === 'setengah_hari');
  const totalOvertime = presentList.reduce((sum, r) => sum + (parseFloat(r.overtime_hours) || 0), 0);

  let submitterText = session && session.submitter_name ? session.submitter_name : 'Draf / Belum Disimpan';
  if (session && session.corrector_names) {
    submitterText += ` (Koreksi: ${session.corrector_names})`;
  }

  const dateFormatted = formatDateIndonesian(targetDate);

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; color: #0f172a; background: #ffffff; line-height: 1.4;">
      <!-- HEADER RESMI -->
      <div style="border-bottom: 3px solid #0284c7; padding-bottom: 14px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="display: inline-block; background: #0284c7; color: #ffffff; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px;">
            Laporan Resmi Lapangan
          </div>
          <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: #0284c7;">${escapeHtml(company)}</h2>
          <h3 style="margin: 2px 0 0 0; font-size: 13px; font-weight: 500; color: #475569;">${escapeHtml(project)}</h3>
        </div>
        <div style="text-align: right; font-size: 11px; color: #475569;">
          <div style="font-size: 14px; font-weight: 700; color: #0f172a;">${dateFormatted}</div>
          <div style="margin-top: 3px;"><strong>Diabsen Oleh:</strong> ${escapeHtml(submitterText)}</div>
          <div style="color: #64748b; font-size: 10px;">Dicetak: ${new Date().toLocaleTimeString('id-ID')} WIB</div>
        </div>
      </div>

      <!-- TITLE -->
      <div style="text-align: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 15px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #0f172a;">
          ABSENSI & LAPORAN PEKERJAAN TUKANG HARIAN
        </h3>
      </div>

      <!-- KPI SUMMARY CARDS -->
      <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 18px;">
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #166534; font-weight: 600; text-transform: uppercase;">Total Hadir</div>
          <div style="font-size: 18px; font-weight: 800; color: #15803d;">${presentList.length} <span style="font-size: 10px; font-weight: 500;">Org</span></div>
        </div>
        <div style="background: #fefce8; border: 1px solid #fef08a; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #854d0e; font-weight: 600; text-transform: uppercase;">½ Hari</div>
          <div style="font-size: 18px; font-weight: 800; color: #a16207;">${halfDayList.length} <span style="font-size: 10px; font-weight: 500;">Org</span></div>
        </div>
        <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #9a3412; font-weight: 600; text-transform: uppercase;">Sakit</div>
          <div style="font-size: 18px; font-weight: 800; color: #c2410c;">${sickList.length} <span style="font-size: 10px; font-weight: 500;">Org</span></div>
        </div>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #991b1b; font-weight: 600; text-transform: uppercase;">Tidak Hadir / Alpa</div>
          <div style="font-size: 18px; font-weight: 800; color: #b91c1c;">${absentList.filter(r => r.status === 'tidak_hadir').length} <span style="font-size: 10px; font-weight: 500;">Org</span></div>
        </div>
        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #075985; font-weight: 600; text-transform: uppercase;">Total Ekstra Jam</div>
          <div style="font-size: 18px; font-weight: 800; color: #0284c7;">${totalOvertime} <span style="font-size: 10px; font-weight: 500;">Jam</span></div>
        </div>
      </div>

      <!-- I. DAFTAR TUKANG HADIR -->
      <div style="margin-bottom: 18px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <h4 style="margin: 0; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #0284c7;">
            I. DAFTAR TUKANG HADIR (${presentList.length} Orang)
          </h4>
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
          <thead>
            <tr style="background: #f1f5f9; text-align: left; color: #334155;">
              <th style="border: 1px solid #cbd5e1; padding: 6px; width: 25px; text-align: center;">No</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px; width: 140px;">Nama Tukang</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px; width: 100px;">Spesialis</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px; width: 75px; text-align: center;">Status</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px;">Pekerjaan / Jobdesk Hari Ini</th>
              <th style="border: 1px solid #cbd5e1; padding: 6px; width: 65px; text-align: center;">Ekstra</th>
            </tr>
          </thead>
          <tbody>
            ${presentList.length === 0 ? `
              <tr><td colspan="6" style="border: 1px solid #cbd5e1; padding: 10px; text-align: center; color: #64748b; font-style: italic;">Belum ada tukang hadir yang tercatat hari ini</td></tr>
            ` : presentList.map((p, idx) => `
              <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: center; color: #64748b;">${idx + 1}</td>
                <td style="border: 1px solid #cbd5e1; padding: 5px; font-weight: bold; color: #0f172a;">
                  ${escapeHtml(p.name)} ${p.is_mandor ? '<span style="color:#eab308;">⭐ (Mandor)</span>' : ''}
                </td>
                <td style="border: 1px solid #cbd5e1; padding: 5px; color: #475569;">${escapeHtml(p.specialist)}</td>
                <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: center; font-weight: 600; color: ${p.status === 'setengah_hari' ? '#b45309' : '#15803d'};">
                  ${p.status === 'setengah_hari' ? '½ Hari' : 'Hadir Penuh'}
                </td>
                <td style="border: 1px solid #cbd5e1; padding: 5px; color: #1e293b;">
                  ${escapeHtml(p.job_description || '-')}
                </td>
                <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: center; font-weight: 700; color: #0284c7;">
                  ${p.overtime_hours} Jam
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- II. DAFTAR TIDAK HADIR / SAKIT -->
      <div style="margin-bottom: 24px;">
        <h4 style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #b91c1c;">
          II. DAFTAR TIDAK HADIR / SAKIT (${absentList.length} Orang)
        </h4>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
          <thead>
            <tr style="background: #fef2f2; text-align: left; color: #991b1b;">
              <th style="border: 1px solid #fecaca; padding: 5px; width: 25px; text-align: center;">No</th>
              <th style="border: 1px solid #fecaca; padding: 5px; width: 140px;">Nama Tukang</th>
              <th style="border: 1px solid #fecaca; padding: 5px; width: 100px;">Spesialis</th>
              <th style="border: 1px solid #fecaca; padding: 5px; width: 100px;">Keterangan</th>
              <th style="border: 1px solid #fecaca; padding: 5px; text-align: right;">Bantuan Biaya Sakit / Obat</th>
            </tr>
          </thead>
          <tbody>
            ${absentList.length === 0 ? `
              <tr><td colspan="5" style="border: 1px solid #fecaca; padding: 8px; text-align: center; color: #15803d; font-weight: 600; background: #f0fdf4;">Nihil (Seluruh tukang hadir bertugas)</td></tr>
            ` : absentList.map((a, idx) => `
              <tr style="background: #fff5f5;">
                <td style="border: 1px solid #fecaca; padding: 5px; text-align: center; color: #64748b;">${idx + 1}</td>
                <td style="border: 1px solid #fecaca; padding: 5px; font-weight: bold; color: #0f172a;">${escapeHtml(a.name)}</td>
                <td style="border: 1px solid #fecaca; padding: 5px; color: #475569;">${escapeHtml(a.specialist)}</td>
                <td style="border: 1px solid #fecaca; padding: 5px; font-weight: bold; color: ${a.status === 'sakit' ? '#c2410c' : '#dc2626'};">
                  ${a.status === 'sakit' ? 'Sakit' : 'Tidak Hadir / Alpa'}
                </td>
                <td style="border: 1px solid #fecaca; padding: 5px; text-align: right; font-weight: 600; color: #0f172a;">
                  ${a.sick_allowance > 0 ? formatRupiah(a.sick_allowance) : '-'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <!-- TANDA TANGAN RESMI -->
      <div style="display: flex; justify-content: space-between; margin-top: 35px; font-size: 11px;">
        <div style="text-align: center; width: 190px;">
          <div style="color: #64748b; font-size: 10px;">Mengetahui & Memverifikasi,</div>
          <div style="margin-top: 45px; font-weight: 700; border-top: 1px solid #94a3b8; padding-top: 4px; color: #0f172a;">
            Site Manager / Mandor Utama
          </div>
        </div>
        <div style="text-align: center; width: 190px;">
          <div style="color: #64748b; font-size: 10px;">Petugas Pencatat Absen,</div>
          <div style="margin-top: 45px; font-weight: 700; border-top: 1px solid #94a3b8; padding-top: 4px; color: #0f172a;">
            ${escapeHtml(session && session.submitter_name ? session.submitter_name : 'Admin Proyek')}
          </div>
        </div>
      </div>
    </div>
  `;

  await generateAndDownloadPDF(html, `Absensi_Tukang_${targetDate}.pdf`, false);
}

// 2. UNDUH PDF STOK MATERIAL (HARI INI)
async function downloadMaterialPDF() {
  showToast('Memuat data stok material...', 'info');

  let materials = state.materials;
  if (!materials || materials.length === 0) {
    try {
      const res = await fetchApi('/api/materials');
      if (res.ok) {
        materials = await res.json();
        state.materials = materials;
      }
    } catch (e) {
      console.error('Fetch materials error', e);
    }
  }

  const company = state.appInfo.companyName || 'PT KARYA CIPTA KONSTRUKSI';
  const project = state.appInfo.projectName || 'Proyek Pembangunan Gedung & Hunian';
  const currentDate = state.currentDate || formatDateStr(new Date());
  const dateFormatted = formatDateIndonesian(currentDate);

  const categories = ['Struktur', 'Arsitektur', 'MEP', 'Inventaris Kantor'];
  const totalItems = materials.length;
  const totalIn = materials.reduce((s, m) => s + (parseFloat(m.in_today) || 0), 0);
  const totalOut = materials.reduce((s, m) => s + (parseFloat(m.out_today) || 0), 0);
  const lowStockCount = materials.filter(m => m.min_stock > 0 && m.stock_today <= m.min_stock).length;

  let tablesHtml = '';
  categories.forEach(cat => {
    const items = materials.filter(m => m.category === cat);
    if (items.length === 0) return;

    tablesHtml += `
      <div style="margin-bottom: 14px;">
        <div style="background: #f1f5f9; padding: 4px 8px; border-left: 3px solid #0284c7; font-size: 11px; font-weight: 700; color: #0369a1; text-transform: uppercase; margin-bottom: 4px;">
          Kategori: ${cat} (${items.length} Item)
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
          <thead>
            <tr style="background: #f8fafc; text-align: left; color: #475569;">
              <th style="border: 1px solid #cbd5e1; padding: 4px; width: 25px; text-align: center;">No</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px;">Nama Barang / Material</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; width: 80px;">Stok Kemarin</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #059669; width: 75px;">Masuk Hari Ini</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #dc2626; width: 75px;">Keluar Hari Ini</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; font-weight: bold; width: 85px;">Sisa Stok</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; width: 55px;">Satuan</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; width: 65px;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, idx) => {
              const isLow = item.min_stock > 0 && item.stock_today <= item.min_stock;
              return `
                <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#fafafa'};">
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #64748b;">${idx + 1}</td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; font-weight: bold; color: #0f172a;">${escapeHtml(item.name)}</td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; color: #475569;">${item.stock_yesterday}</td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #059669; font-weight: bold;">
                    ${item.in_today > 0 ? `+${item.in_today}` : '-'}
                  </td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #dc2626; font-weight: bold;">
                    ${item.out_today > 0 ? `-${item.out_today}` : '-'}
                  </td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; font-weight: 800; color: ${isLow ? '#b91c1c' : '#0f172a'};">
                    ${item.stock_today}
                  </td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #64748b;">${escapeHtml(item.unit)}</td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center;">
                    <span style="display: inline-block; font-size: 8px; font-weight: bold; padding: 1px 4px; border-radius: 3px; background: ${isLow ? '#fee2e2' : '#dcfce7'}; color: ${isLow ? '#b91c1c' : '#15803d'};">
                      ${isLow ? 'MENIPIS' : 'AMAN'}
                    </span>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  });

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; color: #0f172a; background: #ffffff; line-height: 1.4;">
      <!-- HEADER -->
      <div style="border-bottom: 3px solid #0d9488; padding-bottom: 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="display: inline-block; background: #0d9488; color: #ffffff; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px;">
            Laporan Logistik & Gudang
          </div>
          <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a;">${escapeHtml(company)}</h2>
          <h3 style="margin: 2px 0 0 0; font-size: 13px; font-weight: 500; color: #475569;">${escapeHtml(project)}</h3>
        </div>
        <div style="text-align: right; font-size: 11px; color: #475569;">
          <div style="font-size: 14px; font-weight: 700; color: #0f172a;">${dateFormatted}</div>
          <div style="color: #64748b; font-size: 10px; margin-top: 3px;">Auto-Reset Stok Kemarin: Pukul 07:00 WIB</div>
          <div style="color: #64748b; font-size: 10px;">Dicetak: ${new Date().toLocaleTimeString('id-ID')} WIB</div>
        </div>
      </div>

      <!-- TITLE -->
      <div style="text-align: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 15px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #0f172a;">
          LAPORAN ARUS & SISA STOK MATERIAL HARIAN
        </h3>
      </div>

      <!-- STATS KPI -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase;">Total Item Material</div>
          <div style="font-size: 18px; font-weight: 800; color: #0f172a;">${totalItems} <span style="font-size: 10px; font-weight: 500;">Item</span></div>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #166534; font-weight: 600; text-transform: uppercase;">Total Masuk Hari Ini</div>
          <div style="font-size: 18px; font-weight: 800; color: #15803d;">+${totalIn}</div>
        </div>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #991b1b; font-weight: 600; text-transform: uppercase;">Total Keluar Hari Ini</div>
          <div style="font-size: 18px; font-weight: 800; color: #dc2626;">-${totalOut}</div>
        </div>
        <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #92400e; font-weight: 600; text-transform: uppercase;">Item Stok Menipis</div>
          <div style="font-size: 18px; font-weight: 800; color: #b45309;">${lowStockCount} <span style="font-size: 10px; font-weight: 500;">Item</span></div>
        </div>
      </div>

      <!-- TABLES -->
      ${tablesHtml || '<p style="text-align: center; color: #64748b; font-size: 12px; padding: 20px;">Tidak ada data material.</p>'}

      <!-- SIGNATURES -->
      <div style="display: flex; justify-content: space-between; margin-top: 35px; font-size: 11px;">
        <div style="text-align: center; width: 190px;">
          <div style="color: #64748b; font-size: 10px;">Penanggung Jawab Gudang,</div>
          <div style="margin-top: 45px; font-weight: 700; border-top: 1px solid #94a3b8; padding-top: 4px; color: #0f172a;">
            Petugas Logistik / Material
          </div>
        </div>
        <div style="text-align: center; width: 190px;">
          <div style="color: #64748b; font-size: 10px;">Mengetahui,</div>
          <div style="margin-top: 45px; font-weight: 700; border-top: 1px solid #94a3b8; padding-top: 4px; color: #0f172a;">
            Site Manager / Kontraktor
          </div>
        </div>
      </div>
    </div>
  `;

  await generateAndDownloadPDF(html, `Laporan_Stok_Material_${currentDate}.pdf`, false);
}

// 3. UNDUH PDF REKAPAN STOK MATERIAL (HARI KEMARIN)
async function downloadYesterdayMaterialPDF() {
  showToast('Memuat data rekapitulasi kemarin...', 'info');

  let yesterdayDate = '';
  let items = [];

  try {
    const res = await fetchApi('/api/materials/yesterday');
    if (res.ok) {
      const data = await res.json();
      yesterdayDate = data.yesterdayDate;
      items = data.items || [];
    }
  } catch (e) {
    console.error('Fetch yesterday materials error', e);
  }

  if (items.length === 0 && state.materials && state.materials.length > 0) {
    items = state.materials.map(m => ({
      name: m.name,
      category: m.category,
      unit: m.unit,
      stock_yesterday: m.stock_yesterday,
      in_qty: 0,
      out_qty: 0,
      stock_final: m.stock_yesterday
    }));
  }

  const company = state.appInfo.companyName || 'PT KARYA CIPTA KONSTRUKSI';
  const project = state.appInfo.projectName || 'Proyek Pembangunan Gedung & Hunian';
  const dateFormatted = formatDateIndonesian(yesterdayDate);

  const categories = ['Struktur', 'Arsitektur', 'MEP', 'Inventaris Kantor'];
  const totalItems = items.length;
  const totalIn = items.reduce((s, m) => s + (parseFloat(m.in_qty) || 0), 0);
  const totalOut = items.reduce((s, m) => s + (parseFloat(m.out_qty) || 0), 0);

  let tablesHtml = '';
  categories.forEach(cat => {
    const catItems = items.filter(m => m.category === cat);
    if (catItems.length === 0) return;

    tablesHtml += `
      <div style="margin-bottom: 14px;">
        <div style="background: #fef3c7; padding: 4px 8px; border-left: 3px solid #d97706; font-size: 11px; font-weight: 700; color: #92400e; text-transform: uppercase; margin-bottom: 4px;">
          Kategori: ${cat} (${catItems.length} Item)
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
          <thead>
            <tr style="background: #f8fafc; text-align: left; color: #475569;">
              <th style="border: 1px solid #cbd5e1; padding: 4px; width: 25px; text-align: center;">No</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px;">Nama Barang / Material</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; width: 85px;">Stok Awal Kemarin</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #059669; width: 80px;">Masuk Kemarin</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #dc2626; width: 80px;">Keluar Kemarin</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; font-weight: bold; width: 95px;">Sisa Akhir Kemarin</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; width: 60px;">Satuan</th>
            </tr>
          </thead>
          <tbody>
            ${catItems.map((item, idx) => `
              <tr style="background: ${idx % 2 === 0 ? '#ffffff' : '#fafafa'};">
                <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #64748b;">${idx + 1}</td>
                <td style="border: 1px solid #cbd5e1; padding: 4px; font-weight: bold; color: #0f172a;">${escapeHtml(item.name)}</td>
                <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; color: #475569;">${item.stock_yesterday}</td>
                <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #059669; font-weight: bold;">
                  ${item.in_qty > 0 ? `+${item.in_qty}` : '-'}
                </td>
                <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #dc2626; font-weight: bold;">
                  ${item.out_qty > 0 ? `-${item.out_qty}` : '-'}
                </td>
                <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; font-weight: 800; color: #0f172a;">
                  ${item.stock_final}
                </td>
                <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #64748b;">${escapeHtml(item.unit)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  });

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 24px; color: #0f172a; background: #ffffff; line-height: 1.4;">
      <!-- HEADER -->
      <div style="border-bottom: 3px solid #d97706; padding-bottom: 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="display: inline-block; background: #d97706; color: #ffffff; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px;">
            Arsip Rekapitulasi Kemarin
          </div>
          <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: #0f172a;">${escapeHtml(company)}</h2>
          <h3 style="margin: 2px 0 0 0; font-size: 13px; font-weight: 500; color: #475569;">${escapeHtml(project)}</h3>
        </div>
        <div style="text-align: right; font-size: 11px; color: #475569;">
          <div style="font-size: 14px; font-weight: 700; color: #0f172a;">${dateFormatted}</div>
          <div style="color: #64748b; font-size: 10px; margin-top: 3px;">Data penutupan sebelum reset 07:00 WIB</div>
          <div style="color: #64748b; font-size: 10px;">Dicetak: ${new Date().toLocaleTimeString('id-ID')} WIB</div>
        </div>
      </div>

      <!-- TITLE -->
      <div style="text-align: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 15px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #0f172a;">
          REKAPITULASI LAPORAN STOK MATERIAL (HARI KEMARIN)
        </h3>
      </div>

      <!-- STATS KPI -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px;">
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase;">Total Item Material</div>
          <div style="font-size: 18px; font-weight: 800; color: #0f172a;">${totalItems} <span style="font-size: 10px; font-weight: 500;">Item</span></div>
        </div>
        <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #166534; font-weight: 600; text-transform: uppercase;">Pemasukan Kemarin</div>
          <div style="font-size: 18px; font-weight: 800; color: #15803d;">+${totalIn}</div>
        </div>
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 8px 10px; text-align: center;">
          <div style="font-size: 10px; color: #991b1b; font-weight: 600; text-transform: uppercase;">Pengeluaran Kemarin</div>
          <div style="font-size: 18px; font-weight: 800; color: #dc2626;">-${totalOut}</div>
        </div>
      </div>

      <!-- TABLES -->
      ${tablesHtml || '<p style="text-align: center; color: #64748b; font-size: 12px; padding: 20px;">Tidak ada rekapan material kemarin.</p>'}

      <!-- SIGNATURES -->
      <div style="display: flex; justify-content: space-between; margin-top: 35px; font-size: 11px;">
        <div style="text-align: center; width: 190px;">
          <div style="color: #64748b; font-size: 10px;">Penanggung Jawab Gudang,</div>
          <div style="margin-top: 45px; font-weight: 700; border-top: 1px solid #94a3b8; padding-top: 4px; color: #0f172a;">
            Petugas Logistik / Material
          </div>
        </div>
        <div style="text-align: center; width: 190px;">
          <div style="color: #64748b; font-size: 10px;">Mengetahui,</div>
          <div style="margin-top: 45px; font-weight: 700; border-top: 1px solid #94a3b8; padding-top: 4px; color: #0f172a;">
            Site Manager / Kontraktor
          </div>
        </div>
      </div>
    </div>
  `;

  await generateAndDownloadPDF(html, `Rekap_Stok_Material_Kemarin_${yesterdayDate || 'Kemarin'}.pdf`, false);
}

// 4. UNDUH PDF REKAP UPAH MINGGUAN (DIBAGI PER MANDOR & FOOTER PRESISI)
async function downloadPayrollPDF(startDate = null, endDate = null) {
  let payrollData = null;
  let sDate = startDate;
  let eDate = endDate;

  if (!sDate || !eDate) {
    if (state.payrollData && state.payrollData.startDate && state.payrollData.endDate) {
      sDate = state.payrollData.startDate;
      eDate = state.payrollData.endDate;
    } else {
      const now = new Date();
      const day = now.getDay();
      const sun = new Date(now);
      sun.setDate(now.getDate() - day);
      const sat = new Date(sun);
      sat.setDate(sun.getDate() + 6);
      sDate = formatDateStr(sun);
      eDate = formatDateStr(sat);
    }
  }

  showToast('Memuat data rekap upah mingguan...', 'info');

  try {
    const res = await fetchApi(`/api/payroll/weekly?startDate=${sDate}&endDate=${eDate}`);
    if (res.ok) {
      payrollData = await res.json();
    }
  } catch (err) {
    console.error('Fetch payroll error', err);
  }

  if (!payrollData || !payrollData.payrollList) {
    payrollData = state.payrollData;
  }

  if (!payrollData || !payrollData.payrollList) {
    alert('Data rekap upah periode ini belum dapat dimuat.');
    return;
  }

  const company = state.appInfo.companyName || 'PT KARYA CIPTA KONSTRUKSI';
  const project = state.appInfo.projectName || 'Proyek Pembangunan Gedung & Hunian';

  const list = payrollData.payrollList;
  const totalNetAll = payrollData.totalNetAll || 0;
  const totalGrossAll = list.reduce((sum, m) => sum + (m.grossWage || 0), 0);
  const totalLoanDeduct = list.reduce((sum, m) => sum + (m.loanDeductionThisWeek || 0), 0);
  const totalRemainingLoanAll = list.reduce((sum, m) => sum + ((m.remainingLoan !== undefined ? m.remainingLoan : m.remainingLoanAfter) || 0), 0);
  const days = payrollData.days || [];
  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  const dayHeadersPrint = days.map((dateStr, idx) => {
    return `<th style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; width: 30px; font-weight: 700;">${dayNames[idx]}</th>`;
  }).join('');

  // PEMBAGIAN GRUP SESUAI MANDOR
  const mandors = list.filter(w => w.is_mandor === 1);
  const mandorIds = new Set(mandors.map(m => m.id));
  const groups = [];

  mandors.forEach(mandor => {
    const members = list.filter(w => w.mandor_id === mandor.id && w.id !== mandor.id);
    groups.push({
      groupName: `Tim Mandor: ${mandor.name} (${mandor.specialist})`,
      mandorName: mandor.name,
      members: [mandor, ...members] // Mandor baris pertama
    });
  });

  const independents = list.filter(w => !w.is_mandor && (!w.mandor_id || !mandorIds.has(w.mandor_id)));
  if (independents.length > 0) {
    groups.push({
      groupName: 'Tukang Mandiri / Non-Grup',
      mandorName: 'Mandiri',
      members: independents
    });
  }

  if (groups.length === 0) {
    groups.push({
      groupName: 'Daftar Pekerja Proyek',
      mandorName: '-',
      members: list
    });
  }

  // RENDER TABEL PER MANDOR
  let groupsHtml = '';
  groups.forEach((grp, gIdx) => {
    const grpGross = grp.members.reduce((s, m) => s + (m.grossWage || 0), 0);
    const grpLoanDeduct = grp.members.reduce((s, m) => s + (m.loanDeductionThisWeek || 0), 0);
    const grpRemainingLoan = grp.members.reduce((s, m) => s + ((m.remainingLoan !== undefined ? m.remainingLoan : m.remainingLoanAfter) || 0), 0);
    const grpNet = grp.members.reduce((s, m) => s + (m.netWage || 0), 0);

    groupsHtml += `
      <div style="margin-bottom: 16px; page-break-inside: avoid;">
        <div style="background: #f1f5f9; border-left: 4px solid #0284c7; padding: 5px 8px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <div>
            <span style="font-size: 11px; font-weight: 800; color: #0369a1; text-transform: uppercase;">
              ⭐ ${escapeHtml(grp.groupName)}
            </span>
            <span style="font-size: 10px; color: #64748b; margin-left: 6px;">(${grp.members.length} Pekerja)</span>
          </div>
          <div style="font-size: 10px; color: #334155;">
            Total Upah Bersih Tim: <strong style="color: #0284c7; font-size: 11px;">${formatRupiah(grpNet)}</strong>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 9px;">
          <thead>
            <tr style="background: #f8fafc; text-align: left; color: #334155;">
              <th style="border: 1px solid #cbd5e1; padding: 4px; width: 22px; text-align: center;">No</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; min-width: 130px;">Nama Tukang</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; width: 85px;">Spesialis</th>
              ${dayHeadersPrint}
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; width: 75px;">Ekstra Jam</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; width: 85px;">Upah Kotor</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; color: #dc2626; width: 80px;">Potong Kasbon</th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; color: #b45309; width: 80px;">Sisa Kasbon <span style="font-size:7px; font-weight:normal; color:#64748b;">(Info)</span></th>
              <th style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; font-weight: bold; width: 95px;">Upah Bersih</th>
            </tr>
          </thead>
          <tbody>
            ${grp.members.map((m, mIdx) => {
              const remLoan = (m.remainingLoan !== undefined ? m.remainingLoan : m.remainingLoanAfter) || 0;
              const dayCellsPrint = days.map(dateStr => {
                const dayRec = (m.dailyStatus && m.dailyStatus[dateStr]) ? m.dailyStatus[dateStr] : null;
                const st = dayRec ? dayRec.status : null;
                let badgeText = '-';
                let bg = 'transparent';
                let color = '#94a3b8';
                if (st === 'hadir') {
                  badgeText = 'H';
                  bg = '#dcfce7';
                  color = '#15803d';
                } else if (st === 'setengah_hari') {
                  badgeText = '½';
                  bg = '#fef9c3';
                  color = '#854d0e';
                } else if (st === 'sakit') {
                  badgeText = 'S';
                  bg = '#ffedd5';
                  color = '#c2410c';
                } else if (st === 'tidak_hadir') {
                  badgeText = 'A';
                  bg = '#fee2e2';
                  color = '#b91c1c';
                }
                return `<td style="border: 1px solid #cbd5e1; padding: 3px; text-align: center; background: ${bg}; color: ${color}; font-weight: bold;">${badgeText}</td>`;
              }).join('');

              return `
                <tr style="background: ${mIdx % 2 === 0 ? '#ffffff' : '#f8fafc'};">
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #64748b;">${mIdx + 1}</td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; font-weight: bold; color: #0f172a;">
                    ${escapeHtml(m.name)} ${m.is_mandor ? '<span style="color:#eab308;">⭐ (Mandor)</span>' : ''}
                  </td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; color: #475569;">${escapeHtml(m.specialist)}</td>
                  ${dayCellsPrint}
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: center; color: #0369a1; font-weight: 600;">
                    ${m.totalOvertimeHours} jam ${m.totalExtraDays > 0 ? `(+${m.totalExtraDays} hr)` : ''}
                  </td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; color: #334155;">${formatRupiah(m.grossWage)}</td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; color: #dc2626; font-weight: 600;">
                    ${m.loanDeductionThisWeek > 0 ? `-${formatRupiah(m.loanDeductionThisWeek)}` : '-'}
                  </td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; color: #b45309; font-weight: 600;">
                    ${remLoan > 0 ? formatRupiah(remLoan) : '-'}
                  </td>
                  <td style="border: 1px solid #cbd5e1; padding: 4px; text-align: right; font-weight: 800; color: #0284c7;">
                    ${formatRupiah(m.netWage)}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="background: #f1f5f9; font-weight: bold;">
              <td colspan="11" style="border: 1px solid #cbd5e1; padding: 5px; text-align: right; text-transform: uppercase; color: #475569;">
                SUBTOTAL TIM:
              </td>
              <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: right; color: #334155;">
                ${formatRupiah(grpGross)}
              </td>
              <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: right; color: #dc2626;">
                ${grpLoanDeduct > 0 ? `-${formatRupiah(grpLoanDeduct)}` : '-'}
              </td>
              <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: right; color: #b45309; font-size: 8px;">
                ${grpRemainingLoan > 0 ? `${formatRupiah(grpRemainingLoan)}<br><span style="font-size:7px; color:#64748b; font-weight:normal;">(Info Catatan)</span>` : '-'}
              </td>
              <td style="border: 1px solid #cbd5e1; padding: 5px; text-align: right; color: #0284c7; font-weight: 800;">
                ${formatRupiah(grpNet)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  });

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 22px; color: #0f172a; background: #ffffff; line-height: 1.35;">
      <!-- HEADER -->
      <div style="border-bottom: 3px solid #0284c7; padding-bottom: 12px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: flex-end;">
        <div>
          <div style="display: inline-block; background: #0284c7; color: #ffffff; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px;">
            Laporan Keuangan & Upah Kerja
          </div>
          <h2 style="margin: 0; font-size: 19px; font-weight: 800; color: #0284c7;">${escapeHtml(company)}</h2>
          <h3 style="margin: 2px 0 0 0; font-size: 12px; font-weight: 500; color: #475569;">${escapeHtml(project)}</h3>
        </div>
        <div style="text-align: right; font-size: 11px; color: #475569;">
          <div style="font-size: 13px; font-weight: 700; color: #0f172a;">PERIODE MINGGUAN: ${payrollData.startDate} s/d ${payrollData.endDate}</div>
          <div style="color: #64748b; font-size: 10px; margin-top: 2px;">Dicetak: ${new Date().toLocaleTimeString('id-ID')} WIB</div>
        </div>
      </div>

      <!-- TITLE & KPI -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 12px;">
        <div style="font-size: 9px; color: #475569; display: flex; gap: 10px; align-items: center;">
          <strong style="color: #0f172a;">Legenda Kehadiran:</strong>
          <span style="color: #15803d; font-weight: 700; background: #dcfce7; padding: 1px 4px; border-radius: 2px;">[H] Hadir</span>
          <span style="color: #854d0e; font-weight: 700; background: #fef9c3; padding: 1px 4px; border-radius: 2px;">[½] Setengah Hari</span>
          <span style="color: #c2410c; font-weight: 700; background: #ffedd5; padding: 1px 4px; border-radius: 2px;">[S] Sakit</span>
          <span style="color: #b91c1c; font-weight: 700; background: #fee2e2; padding: 1px 4px; border-radius: 2px;">[A] Alpa / Tidak Hadir</span>
        </div>
        <div style="display: flex; gap: 16px; font-size: 11px;">
          <div>Total Upah Kotor: <strong style="color: #0f172a;">${formatRupiah(totalGrossAll)}</strong></div>
          <div>Total Potongan: <strong style="color: #dc2626;">${totalLoanDeduct > 0 ? `-${formatRupiah(totalLoanDeduct)}` : 'Rp 0'}</strong></div>
          <div>Total Bersih: <strong style="color: #0284c7; font-size: 12px;">${formatRupiah(totalNetAll)}</strong></div>
          <div style="border-left: 1px solid #cbd5e1; padding-left: 10px; color: #64748b; font-size: 10px;">
            Sisa Kasbon: <strong style="color: #b45309;">${formatRupiah(totalRemainingLoanAll)}</strong> <span style="font-size: 8px; font-weight: normal;">(Info Catatan)</span>
          </div>
        </div>
      </div>

      <!-- TABEL-TABEL PER MANDOR -->
      ${groupsHtml}

      <!-- GRAND TOTAL SUMMARY TABLE (15 KOLOM PRESISI) -->
      <div style="margin-top: 14px; margin-bottom: 20px; page-break-inside: avoid;">
        <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
          <tbody>
            <tr style="background: #0f172a; color: #ffffff;">
              <td colspan="11" style="border: 1px solid #0f172a; padding: 8px 10px; text-align: right; text-transform: uppercase; font-weight: 800; letter-spacing: 0.04em;">
                TOTAL PEMBAYARAN KESELURUHAN (UPAH BERSIH = KOTOR - POTONG KASBON):
              </td>
              <td style="border: 1px solid #0f172a; padding: 8px 6px; text-align: right; font-weight: 800; width: 85px; color: #ffffff;">
                ${formatRupiah(totalGrossAll)}
              </td>
              <td style="border: 1px solid #0f172a; padding: 8px 6px; text-align: right; font-weight: 800; width: 80px; color: #fca5a5;">
                ${totalLoanDeduct > 0 ? `-${formatRupiah(totalLoanDeduct)}` : '-'}
              </td>
              <td style="border: 1px solid #0f172a; padding: 8px 6px; text-align: right; font-weight: 700; width: 80px; color: #fde68a; font-size: 8px;">
                ${totalRemainingLoanAll > 0 ? `${formatRupiah(totalRemainingLoanAll)}<br><span style="font-size:7px; color:#cbd5e1; font-weight:normal;">(Info Catatan)</span>` : '-'}
              </td>
              <td style="border: 1px solid #0f172a; padding: 8px 6px; text-align: right; font-weight: 800; width: 95px; color: #38bdf8; font-size: 11px;">
                ${formatRupiah(totalNetAll)}
              </td>
            </tr>
          </tbody>
        </table>
        <div style="font-size: 8.5px; color: #64748b; margin-top: 5px; font-style: italic;">
          * Catatan: Kolom <strong>Sisa Kasbon</strong> hanya bersifat catatan informatif saldo pinjaman pekerja dan <strong>tidak memiliki rumus yang mempengaruhi Grand Total Upah Bersih</strong> (Grand Total Bersih murni = Total Upah Kotor - Total Potong Kasbon).
        </div>
      </div>

      <!-- SIGNATURES -->
      <div style="display: flex; justify-content: space-between; margin-top: 30px; font-size: 10px;">
        <div style="text-align: center; width: 180px;">
          <div style="color: #64748b;">Dibuat & Dihitung oleh,</div>
          <div style="margin-top: 40px; border-top: 1px solid #94a3b8; padding-top: 3px; font-weight: 700; color: #0f172a;">Admin Keuangan / Proyek</div>
        </div>
        <div style="text-align: center; width: 180px;">
          <div style="color: #64748b;">Disetujui oleh,</div>
          <div style="margin-top: 40px; border-top: 1px solid #94a3b8; padding-top: 3px; font-weight: 700; color: #0f172a;">Project Manager / Kontraktor</div>
        </div>
      </div>
    </div>
  `;

  await generateAndDownloadPDF(html, `Rekap_Upah_${payrollData.startDate}_sd_${payrollData.endDate}.pdf`, true);
}

// Aliases for compatibility
const printAttendancePDF = () => downloadAttendancePDF();
const printMaterialPDF = () => downloadMaterialPDF();
const printPayrollSlip = () => downloadPayrollPDF();

function formatDateIndonesian(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const dayName = days[d.getDay()] || '';
  const monthName = months[d.getMonth()] || parts[1];
  return `${dayName}, ${parseInt(parts[2], 10)} ${monthName} ${parts[0]}`;
}

// --- PENGATURAN (PIN & RIWAYAT) ---
async function verifySettingsPin() {
  const pinInput = document.getElementById('input-settings-pin');
  const pin = pinInput ? pinInput.value.trim() : '';

  if (!pin) {
    showToast('Ketik PIN Admin terlebih dahulu', 'error');
    pinInput?.focus();
    return;
  }

  try {
    const res = await fetchApi('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (res.ok && data.valid) {
      state.isSettingsUnlocked = true;
      if (pinInput) pinInput.value = '';
      const lockedView = document.getElementById('settings-locked-view');
      const unlockedView = document.getElementById('settings-unlocked-view');
      if (lockedView) lockedView.style.display = 'none';
      if (unlockedView) unlockedView.style.display = 'block';
      await loadAppInfo();
      await loadPayrollHistory();
      showToast('Pengaturan berhasil dibuka!', 'success');
    } else {
      showToast(data.message || 'PIN Admin Salah!', 'error');
      if (pinInput) {
        pinInput.value = '';
        pinInput.focus();
      }
    }
  } catch (err) {
    showToast('Gagal memverifikasi PIN: ' + err.message, 'error');
    pinInput?.focus();
  }
}

async function loadPayrollHistory() {
  const container = document.getElementById('settings-payroll-history-container');
  if (!container) return;
  container.innerHTML = '<p class="text-muted" style="font-size: 13px;">Memuat riwayat rekap...</p>';

  try {
    const res = await fetchApi('/api/payroll/history');
    if (!res.ok) throw new Error('Gagal mengambil riwayat');
    const periods = await res.json();

    if (!periods || periods.length === 0) {
      container.innerHTML = '<p class="text-muted" style="font-size: 13px; margin: 0.5rem 0;">Belum ada riwayat rekap upah yang memiliki data absensi.</p>';
      return;
    }

    let html = `
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${periods.map(p => {
          const startShort = formatShortDate(p.startDate);
          const endShort = formatShortDate(p.endDate);
          const year = p.endDate.substring(0, 4);
          return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
              <div>
                <strong style="color: var(--text-primary); font-size: 13px;">Minggu ${startShort} – ${endShort} ${year}</strong>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${p.recordCount} catatan absensi tukang</div>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="downloadPayrollPDF('${p.startDate}', '${p.endDate}')" style="display: inline-flex; align-items: center; gap: 6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Unduh PDF
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p class="text-danger" style="font-size: 13px;">Gagal memuat riwayat: ${escapeHtml(err.message)}</p>`;
  }
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[2], 10);
    const month = months[parseInt(parts[1], 10) - 1] || parts[1];
    return `${day} ${month}`;
  }
  return dateStr;
}

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(number || 0);
}

function formatDateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0
  }).format(number || 0);
}

function formatDateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
