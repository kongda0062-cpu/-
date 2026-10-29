const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const dbFile = path.join(__dirname, 'platform.db');
const db = new sqlite3.Database(dbFile, (err) => {
    if (err) console.error('DB 연결 실패:', err.message);
    else console.log('✅ SQLite 데이터베이스 연결 성공!');
});

// 📱 카카오톡 알림톡 발송 모듈
function sendKakaoNotification(phone, templateType, data) {
    console.log(`\n[💬 카카오톡 알림톡 발송 요청]`);
    console.log(`수신번호: ${phone}`);
    if (templateType === 'APPLY_COMPLETE') {
        console.log(`내용: [맛집노트] '${data.title}' 체험단 신청이 완료되었습니다. 사장님 심사 후 안내해 드리겠습니다.`);
    } else if (templateType === 'STATUS_PASS') {
        console.log(`내용: 🎉 축하합니다! '${data.title}' 체험단에 [최종 합격]되셨습니다. 가이드를 확인해 주세요.`);
    } else if (templateType === 'STATUS_FAIL') {
        console.log(`내용: [맛집노트] 아쉽게도 '${data.title}' 체험단 선정에서 제외되셨습니다.`);
    } else if (templateType === 'NEW_APPLICANT') {
        console.log(`내용: [사장님 알림] '${data.title}' 체험단에 새로운 블로거(${data.applicantName})가 지원했습니다!`);
    }
    console.log(`------------------------------------\n`);
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        phone TEXT,
        blog TEXT,
        insta TEXT,
        address TEXT,
        today_visitors INTEGER DEFAULT 0,
        total_visitors INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        offer TEXT,
        channel TEXT,
        image TEXT,
        limit_count INTEGER,
        advertiser_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER,
        user_id INTEGER,
        memo TEXT,
        status TEXT DEFAULT '심사중',
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.get("SELECT COUNT(*) as count FROM campaigns", (err, row) => {
        if (row && row.count === 0) {
            db.run(`INSERT INTO campaigns (title, offer, channel, image, limit_count, advertiser_name) VALUES 
                ('[강남] 프리미엄 우마카세 2인 식사권', '오마카세 코스 2인 제공 (15만원 상당)', 'blog', 'https://images.unsplash.com/photo-1544025162-d76694265947?w=500', 5, '우마카세 강남점'),
                ('[성수] 감성 카페 디저트 & 음료 세트', '시그니처 음료 2잔 + 케이크 1종', 'insta', 'https://images.unsplash.com/photo-1559925393-8be0ec4767c8?w=500', 10, '성수 카페로우'),
                ('[배송] 유기농 프리미엄 멀티비타민', '멀티비타민 2개월분 본품 택배 발송', 'blog', 'https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=500', 20, '바이오랩 코리아')
            `);
        }
    });
});

// API Routes
app.get('/api/campaigns', (req, res) => {
    db.all("SELECT * FROM campaigns ORDER BY id DESC", [], (err, rows) => { res.json(rows); });
});

app.post('/api/campaigns', (req, res) => {
    const { title, offer, channel, image, limit_count, advertiser_name } = req.body;
    const defaultImg = image || 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=500';
    db.run(`INSERT INTO campaigns (title, offer, channel, image, limit_count, advertiser_name) VALUES (?, ?, ?, ?, ?, ?)`,
        [title, offer, channel, defaultImg, limit_count || 5, advertiser_name], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, campaignId: this.lastID });
        }
    );
});

app.post('/api/user', (req, res) => {
    const { name, phone, blog, insta, address, today_visitors, total_visitors } = req.body;
    db.get("SELECT id FROM users WHERE id = 1", (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (name, phone, blog, insta, address, today_visitors, total_visitors) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
                [name, phone, blog, insta, address, today_visitors || 0, total_visitors || 0], function(err) {
                    res.json({ success: true, userId: this.lastID });
                });
        } else {
            db.run(`UPDATE users SET name=?, phone=?, blog=?, insta=?, address=?, today_visitors=?, total_visitors=? WHERE id=1`, 
                [name, phone, blog, insta, address, today_visitors || 0, total_visitors || 0], (err) => {
                    res.json({ success: true, userId: 1 });
                });
        }
    });
});

app.get('/api/user/1', (req, res) => {
    db.get("SELECT * FROM users WHERE id = 1", [], (err, row) => { res.json(row || null); });
});

app.post('/api/apply', (req, res) => {
    const { campaign_id, memo } = req.body;
    const user_id = 1;

    db.get("SELECT id FROM applications WHERE campaign_id = ? AND user_id = ?", [campaign_id, user_id], (err, row) => {
        if (row) return res.status(400).json({ error: "이미 신청한 체험단입니다." });
        
        db.run(`INSERT INTO applications (campaign_id, user_id, memo) VALUES (?, ?, ?)`, 
            [campaign_id, user_id, memo], function(err) {
                db.get("SELECT name, phone FROM users WHERE id = ?", [user_id], (uErr, user) => {
                    db.get("SELECT title FROM campaigns WHERE id = ?", [campaign_id], (cErr, campaign) => {
                        if (user && campaign) {
                            sendKakaoNotification(user.phone, 'APPLY_COMPLETE', { title: campaign.title });
                            sendKakaoNotification('010-0000-0000', 'NEW_APPLICANT', { title: campaign.title, applicantName: user.name });
                        }
                    });
                });

                res.json({ success: true, appId: this.lastID });
            });
    });
});

app.delete('/api/applications/:id', (req, res) => {
    const appId = req.params.id;
    db.run(`DELETE FROM applications WHERE id = ?`, [appId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

app.get('/api/applications', (req, res) => {
    const query = `
        SELECT a.id, a.status, a.memo, a.applied_at, c.title, c.offer, c.image, c.id as campaign_id
        FROM applications a
        JOIN campaigns c ON a.campaign_id = c.id
        WHERE a.user_id = 1
    `;
    db.all(query, [], (err, rows) => { res.json(rows); });
});

app.get('/api/admin/applicants/:campaign_id', (req, res) => {
    const { campaign_id } = req.params;
    const query = `
        SELECT a.id as app_id, a.status, a.memo, a.applied_at,
               u.name, u.phone, u.blog, u.insta, u.address,
               u.today_visitors, u.total_visitors
        FROM applications a
        JOIN users u ON a.user_id = u.id
        WHERE a.campaign_id = ?
    `;
    db.all(query, [campaign_id], (err, rows) => { res.json(rows); });
});

app.post('/api/admin/update-status', (req, res) => {
    const { app_id, status } = req.body;
    db.run(`UPDATE applications SET status = ? WHERE id = ?`, [status, app_id], function(err) {
        db.get(`SELECT u.phone, c.title FROM applications a 
                JOIN users u ON a.user_id = u.id 
                JOIN campaigns c ON a.campaign_id = c.id 
                WHERE a.id = ?`, [app_id], (err, row) => {
            if (row) {
                const template = status === '합격' ? 'STATUS_PASS' : 'STATUS_FAIL';
                sendKakaoNotification(row.phone, template, { title: row.title });
            }
        });

        res.json({ success: true });
    });
});

// Front-End View (맛집노트 브랜딩 적용)
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>맛집노트 - 식당·카페 사장님을 위한 100% 무료 블로그 체험단</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    </head>
    <body class="bg-gray-50 text-gray-800 pb-20">
        <header class="bg-white border-b sticky top-0 z-40 shadow-sm">
            <div class="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
                <div class="flex items-center space-x-2 cursor-pointer" onclick="switchTab('home')">
                    <span class="text-2xl">📝🍳</span>
                    <span class="text-xl font-bold bg-gradient-to-r from-orange-500 to-amber-500 bg-clip-text text-transparent">맛집노트</span>
                </div>
                <div class="flex items-center space-x-2 md:space-x-3">
                    <button onclick="openRegisterModal()" class="text-xs md:text-sm px-3 py-1.5 rounded-full bg-orange-500 text-white font-bold hover:bg-orange-600 transition shadow-sm">
                        <i class="fa-solid fa-plus mr-1"></i> 체험단 등록하기(무료)
                    </button>
                    <button onclick="openProfileModal()" id="profile-btn-text" class="text-xs md:text-sm px-3 py-1.5 rounded-full border border-gray-300 hover:border-orange-500 hover:text-orange-500 transition">
                        <i class="fa-solid fa-user-gear mr-1"></i> 내 프로필
                    </button>
                    <button onclick="switchTab('my-app')" class="text-xs md:text-sm px-3 py-1.5 rounded-full bg-amber-500 text-white font-medium hover:bg-amber-600 transition">신청 내역</button>
                    <button onclick="switchTab('admin')" class="text-xs md:text-sm px-3 py-1.5 rounded-full bg-gray-900 text-white font-medium hover:bg-gray-800 transition"><i class="fa-solid fa-store mr-1"></i> 사장님 모드</button>
                </div>
            </div>
        </header>

        <main id="view-home" class="max-w-6xl mx-auto px-4 pt-6">
            <div class="bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 rounded-2xl p-6 text-white mb-8 shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <span class="bg-white/20 px-3 py-1 rounded-full text-xs font-semibold">중개 수수료 0원!</span>
                    <h1 class="text-2xl md:text-3xl font-extrabold mt-2">우리 동네 맛집 마케팅의 시작, 맛집노트</h1>
                    <p class="text-orange-100 text-sm mt-1">사장님은 무료로 모집하고, 블로거는 맛집 체험을 받아보세요.</p>
                </div>
                <button onclick="openRegisterModal()" class="bg-white text-orange-600 font-bold px-5 py-3 rounded-xl hover:bg-orange-50 shadow-md transition text-sm">
                    ✨ 사장님 무료 등록하기
                </button>
            </div>
            <div id="campaign-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"></div>
        </main>

        <main id="view-my-app" class="max-w-4xl mx-auto px-4 pt-6 hidden">
            <h2 class="text-2xl font-bold mb-6"><i class="fa-solid fa-list-check text-orange-500 mr-2"></i>내가 신청한 내역</h2>
            <div id="my-app-list" class="space-y-4"></div>
        </main>

        <main id="view-admin" class="max-w-6xl mx-auto px-4 pt-6 hidden">
            <div class="bg-white p-6 rounded-2xl border shadow-sm">
                <h2 class="text-xl font-bold text-gray-900 mb-2"><i class="fa-solid fa-store text-orange-500 mr-2"></i>광고주(사장님) 지원자 심사 모드</h2>
                <p class="text-xs text-gray-500 mb-6">합격/탈락 버튼을 누르면 해당 지원자에게 **카카오톡 알림**이 자동으로 전송됩니다.</p>
                
                <label class="block text-xs font-bold text-gray-700 mb-2">관리할 체험단 선택</label>
                <select id="admin-campaign-select" onchange="loadApplicants()" class="w-full p-3 border rounded-xl text-sm mb-6 focus:ring-2 focus:ring-orange-500 outline-none"></select>

                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="border-b bg-gray-50 text-xs text-gray-500">
                                <th class="p-3">신청자명 / 연락처</th>
                                <th class="p-3">방문자수 지표</th>
                                <th class="p-3">SNS 링크</th>
                                <th class="p-3">신청 한마디</th>
                                <th class="p-3">상태</th>
                                <th class="p-3">합격 선정 (카톡알림)</th>
                            </tr>
                        </thead>
                        <tbody id="admin-applicant-table"></tbody>
                    </table>
                </div>
            </div>
        </main>

        <!-- REGISTER CAMPAIGN MODAL -->
        <div id="modal-register" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 hidden">
            <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                <button onclick="closeModal('modal-register')" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
                <h3 class="text-xl font-bold mb-1">📢 체험단 무료 모집글 등록</h3>
                <p class="text-xs text-orange-600 font-semibold mb-4">현재 오픈 이벤트로 수수료없이 무료로 작성 가능합니다!</p>
                <form onsubmit="submitNewCampaign(event)" class="space-y-3">
                    <div>
                        <label class="block text-xs font-bold text-gray-600 mb-1">상호명(가게 이름)</label>
                        <input type="text" id="c-advertiser" required placeholder="예: 맛있는갈비 강남점" class="w-full p-3 border rounded-xl text-sm">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-600 mb-1">체험단 모집 제목</label>
                        <input type="text" id="c-title" required placeholder="예: [강남] 수제 양념갈비 2인 식사권" class="w-full p-3 border rounded-xl text-sm">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-600 mb-1">제공 상품/서비스 내역</label>
                        <input type="text" id="c-offer" required placeholder="예: 돼지갈비 2인분 + 냉면 1개 제공 (5만원 상당)" class="w-full p-3 border rounded-xl text-sm">
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <label class="block text-xs font-bold text-gray-600 mb-1">모집 채널</label>
                            <select id="c-channel" class="w-full p-3 border rounded-xl text-sm bg-white">
                                <option value="blog">네이버 블로그</option>
                                <option value="insta">인스타그램</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-600 mb-1">모집 인원 (명)</label>
                            <input type="number" id="c-limit" value="5" required class="w-full p-3 border rounded-xl text-sm">
                        </div>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-600 mb-1">대표 이미지 URL (선택)</label>
                        <input type="url" id="c-image" placeholder="미입력 시 기본 분위기 이미지로 등록됩니다" class="w-full p-3 border rounded-xl text-sm">
                    </div>
                    <button type="submit" class="w-full bg-orange-500 text-white font-bold py-3 rounded-xl hover:bg-orange-600 transition mt-3">무료 모집글 즉시 등록하기</button>
                </form>
            </div>
        </div>

        <!-- PROFILE MODAL -->
        <div id="modal-profile" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 hidden">
            <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                <button onclick="closeModal('modal-profile')" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
                <h3 class="text-xl font-bold mb-1">리뷰어 프로필 설정</h3>
                <p class="text-xs text-gray-400 mb-4">카카오 알림톡 수신을 위해 정확한 연락처를 적어주세요.</p>
                <form onsubmit="saveProfile(event)" class="space-y-3">
                    <input type="text" id="p-name" required placeholder="이름 (예: 홍길동)" class="w-full p-3 border rounded-xl text-sm">
                    <input type="tel" id="p-phone" required placeholder="연락처 (010-0000-0000)" class="w-full p-3 border rounded-xl text-sm">
                    <input type="url" id="p-blog" placeholder="네이버 블로그 주소" class="w-full p-3 border rounded-xl text-sm">
                    <input type="text" id="p-insta" placeholder="인스타그램 ID" class="w-full p-3 border rounded-xl text-sm">
                    <textarea id="p-address" required placeholder="배송지 주소" rows="2" class="w-full p-3 border rounded-xl text-sm resize-none"></textarea>
                    
                    <div class="grid grid-cols-2 gap-2 pt-2">
                        <div>
                            <label class="block text-xs font-bold text-gray-600 mb-1">일 평균 방문자수</label>
                            <input type="number" id="p-today" required placeholder="예: 1500" class="w-full p-3 border rounded-xl text-sm">
                        </div>
                        <div>
                            <label class="block text-xs font-bold text-gray-600 mb-1">총 누적 방문자수</label>
                            <input type="number" id="p-total" required placeholder="예: 50000" class="w-full p-3 border rounded-xl text-sm">
                        </div>
                    </div>

                    <button type="submit" class="w-full bg-orange-500 text-white font-bold py-3 rounded-xl hover:bg-orange-600 transition mt-3">프로필 저장하기</button>
                </form>
            </div>
        </div>

        <!-- APPLY MODAL -->
        <div id="modal-apply" class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 hidden">
            <div class="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
                <button onclick="closeModal('modal-apply')" class="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
                <h3 id="apply-title" class="text-lg font-bold mb-1">체험단 신청</h3>
                <p id="apply-offer" class="text-xs text-orange-600 font-semibold mb-4"></p>
                <form onsubmit="submitApply(event)" class="space-y-3">
                    <input type="hidden" id="apply-campaign-id">
                    <textarea id="apply-memo" required placeholder="사장님께 전할 신청 한마디" rows="3" class="w-full p-3 border rounded-xl text-sm resize-none"></textarea>
                    <button type="submit" class="w-full bg-orange-500 text-white font-bold py-3 rounded-xl hover:bg-orange-600 transition">신청 완료하기 (카톡알림 전송)</button>
                </form>
            </div>
        </div>

        <script>
            let campaigns = [];
            let currentUser = null;

            window.onload = async () => {
                await loadCampaigns();
                await loadUserProfile();
            };

            function switchTab(tab) {
                document.getElementById('view-home').classList.add('hidden');
                document.getElementById('view-my-app').classList.add('hidden');
                document.getElementById('view-admin').classList.add('hidden');
                document.getElementById('view-' + tab).classList.remove('hidden');

                if (tab === 'my-app') loadMyApp();
                if (tab === 'admin') loadAdminCampaigns();
            }

            function closeModal(modalId) {
                document.getElementById(modalId).classList.add('hidden');
            }

            async function loadCampaigns() {
                const res = await fetch('/api/campaigns');
                campaigns = await res.json();
                const grid = document.getElementById('campaign-grid');
                grid.innerHTML = '';
                campaigns.forEach(c => {
                    grid.innerHTML += `
                        <div class="bg-white rounded-2xl border overflow-hidden shadow-sm flex flex-col hover:shadow-md transition">
                            <div class="relative h-48">
                                <img src="${c.image}" class="w-full h-full object-cover">
                                <span class="absolute top-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded">가게: ${c.advertiser_name}</span>
                                <span class="absolute top-3 right-3 bg-emerald-500 text-white text-xs font-bold px-2 py-1 rounded-full">모집 ${c.limit_count}명</span>
                            </div>
                            <div class="p-4 flex-1 flex flex-col justify-between">
                                <div>
                                    <h3 class="font-bold text-gray-900 mb-1">${c.title}</h3>
                                    <p class="text-xs text-orange-600 font-medium mb-3">${c.offer}</p>
                                </div>
                                <button onclick="openApplyModal(${c.id})" class="w-full py-2.5 bg-gray-900 hover:bg-orange-500 text-white font-bold rounded-xl text-xs transition">신청하기</button>
                            </div>
                        </div>
                    `;
                });
            }

            async function loadUserProfile() {
                const res = await fetch('/api/user/1');
                currentUser = await res.json();
                const btn = document.getElementById('profile-btn-text');
                if (currentUser && currentUser.name) {
                    btn.innerHTML = `<i class="fa-solid fa-user-check mr-1"></i> ${currentUser.name}님 프로필`;
                }
            }

            function openRegisterModal() {
                document.getElementById('modal-register').classList.remove('hidden');
            }

            async function submitNewCampaign(e) {
                e.preventDefault();
                const data = {
                    advertiser_name: document.getElementById('c-advertiser').value,
                    title: document.getElementById('c-title').value,
                    offer: document.getElementById('c-offer').value,
                    channel: document.getElementById('c-channel').value,
                    limit_count: document.getElementById('c-limit').value,
                    image: document.getElementById('c-image').value
                };
                const res = await fetch('/api/campaigns', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (res.ok) {
                    alert('🎉 무료 체험단 모집글이 성공적으로 메인에 등록되었습니다!');
                    closeModal('modal-register');
                    loadCampaigns();
                }
            }

            function openProfileModal() {
                if (currentUser) {
                    document.getElementById('p-name').value = currentUser.name || '';
                    document.getElementById('p-phone').value = currentUser.phone || '';
                    document.getElementById('p-blog').value = currentUser.blog || '';
                    document.getElementById('p-insta').value = currentUser.insta || '';
                    document.getElementById('p-address').value = currentUser.address || '';
                    document.getElementById('p-today').value = currentUser.today_visitors || '';
                    document.getElementById('p-total').value = currentUser.total_visitors || '';
                }
                document.getElementById('modal-profile').classList.remove('hidden');
            }

            async function saveProfile(e) {
                e.preventDefault();
                const data = {
                    name: document.getElementById('p-name').value,
                    phone: document.getElementById('p-phone').value,
                    blog: document.getElementById('p-blog').value,
                    insta: document.getElementById('p-insta').value,
                    address: document.getElementById('p-address').value,
                    today_visitors: document.getElementById('p-today').value,
                    total_visitors: document.getElementById('p-total').value
                };
                const res = await fetch('/api/user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if(res.ok) {
                    alert('프로필 및 방문자수가 저장되었습니다.');
                    closeModal('modal-profile');
                    loadUserProfile();
                }
            }

            function openApplyModal(id) {
                if (!currentUser || !currentUser.name) {
                    alert('먼저 프로필을 등록해주세요!');
                    openProfileModal();
                    return;
                }
                const c = campaigns.find(x => x.id === id);
                document.getElementById('apply-campaign-id').value = c.id;
                document.getElementById('apply-title').innerText = c.title;
                document.getElementById('apply-offer').innerText = c.offer;
                document.getElementById('modal-apply').classList.remove('hidden');
            }

            async function submitApply(e) {
                e.preventDefault();
                const data = {
                    campaign_id: document.getElementById('apply-campaign-id').value,
                    memo: document.getElementById('apply-memo').value
                };
                const res = await fetch('/api/apply', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if(res.ok) {
                    alert('체험단 신청 완료! (신청 내역 카카오 알림 시뮬레이션 전송됨)');
                    closeModal('modal-apply');
                } else {
                    alert(result.error);
                }
            }

            async function loadMyApp() {
                const res = await fetch('/api/applications');
                const list = await res.json();
                const container = document.getElementById('my-app-list');
                if (list.length === 0) {
                    container.innerHTML = '<p class="text-center text-gray-400 py-10">신청한 내역이 없습니다.</p>';
                    return;
                }
                container.innerHTML = '';
                list.forEach(item => {
                    let badgeColor = item.status === '합격' ? 'bg-green-100 text-green-700' : (item.status === '탈락' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-800');
                    container.innerHTML += `
                        <div class="bg-white p-4 rounded-xl border flex items-center justify-between shadow-sm">
                            <div class="flex items-center gap-4">
                                <img src="${item.image}" class="w-16 h-16 rounded-lg object-cover">
                                <div>
                                    <span class="text-xs font-bold px-2 py-0.5 rounded ${badgeColor}">상태: ${item.status}</span>
                                    <h4 class="font-bold text-gray-800 text-sm mt-1">${item.title}</h4>
                                    <p class="text-xs text-gray-500">${item.offer}</p>
                                    <p class="text-xs text-gray-400 mt-1">내 포부: "${item.memo}"</p>
                                </div>
                            </div>
                            <div>
                                <button onclick="cancelApplication(${item.id})" class="bg-gray-100 hover:bg-red-100 hover:text-red-600 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-bold transition">
                                    신청 취소
                                </button>
                            </div>
                        </div>
                    `;
                });
            }

            async function cancelApplication(appId) {
                if(!confirm('정말 신청을 취소하시겠습니까?')) return;
                const res = await fetch(`/api/applications/${appId}`, { method: 'DELETE' });
                if(res.ok) {
                    alert('신청이 취소되었습니다.');
                    loadMyApp();
                }
            }

            async function loadAdminCampaigns() {
                const select = document.getElementById('admin-campaign-select');
                select.innerHTML = '';
                campaigns.forEach(c => {
                    select.innerHTML += `<option value="${c.id}">[${c.advertiser_name}] ${c.title}</option>`;
                });
                loadApplicants();
            }

            async function loadApplicants() {
                const campaignId = document.getElementById('admin-campaign-select').value;
                if(!campaignId) return;
                const res = await fetch(`/api/admin/applicants/${campaignId}`);
                const applicants = await res.json();
                const tbody = document.getElementById('admin-applicant-table');
                tbody.innerHTML = '';

                if(applicants.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-gray-400 text-sm">지원한 블로거가 없습니다.</td></tr>';
                    return;
                }

                applicants.forEach(a => {
                    let badgeColor = a.status === '합격' ? 'bg-green-100 text-green-700' : (a.status === '탈락' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-800');
                    tbody.innerHTML += `
                        <tr class="border-b text-sm">
                            <td class="p-3 font-bold">${a.name}<br><span class="text-xs text-gray-400">${a.phone}</span></td>
                            <td class="p-3">
                                <div class="text-xs font-bold text-orange-600">🔥 오늘 방문: ${Number(a.today_visitors || 0).toLocaleString()}명</div>
                                <div class="text-xs text-gray-500">총 방문: ${Number(a.total_visitors || 0).toLocaleString()}명</div>
                            </td>
                            <td class="p-3">
                                ${a.blog ? `<a href="${a.blog}" target="_blank" class="text-blue-600 underline block text-xs font-semibold">블로그 바로가기</a>` : '미등록'}
                            </td>
                            <td class="p-3 text-xs text-gray-600">"${a.memo}"</td>
                            <td class="p-3"><span class="px-2 py-1 rounded text-xs font-bold ${badgeColor}">${a.status}</span></td>
                            <td class="p-3 space-x-1">
                                <button onclick="updateStatus(${a.app_id}, '합격')" class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-bold transition">합격(카톡알림)</button>
                                <button onclick="updateStatus(${a.app_id}, '탈락')" class="bg-gray-300 hover:bg-gray-400 text-gray-700 px-3 py-1 rounded text-xs transition">탈락</button>
                            </td>
                        </tr>
                    `;
                });
            }

            async function updateStatus(appId, status) {
                await fetch('/api/admin/update-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ app_id: appId, status: status })
                });
                loadApplicants();
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => {
    console.log(`맛집노트 서버가 포트 ${PORT}번에서 정상적으로 실행 중입니다!`);
});