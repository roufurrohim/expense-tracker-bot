const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN || '6376570426:AAFTdsn9D1qeqa7VHFLTEe24eV6JRT-tfB8';
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || '1c6h4qs_6KDIz1xsj5I5ML1qWciy9HcqFhbhtrvpdd8E';
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;

// Inisialisasi bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// File untuk menyimpan data lokal (backup)
const DATA_FILE = path.join(__dirname, 'expenses.json');

// Setup Google Sheets authentication
const serviceAccountAuth = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

let doc;

// Fungsi helper untuk escape Markdown
function escapeMarkdown(text) {
    return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// Inisialisasi Google Sheets
async function initializeGoogleSheets() {
    try {
        doc = new GoogleSpreadsheet(GOOGLE_SHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        console.log('✅ Google Sheets connected:', doc.title);
        
        // Buat sheet jika belum ada
        await setupSheetsStructure();
    } catch (error) {
        console.error('❌ Google Sheets connection failed:', error.message);
        console.log('📝 Bot akan tetap berjalan dengan penyimpanan lokal');
    }
}

// Setup struktur sheets
async function setupSheetsStructure() {
    try {
        // Cek apakah sheet "Expenses" sudah ada
        let expenseSheet = doc.sheetsByTitle['Expenses'];
        
        if (!expenseSheet) {
            // Buat sheet baru
            expenseSheet = await doc.addSheet({
                title: 'Expenses',
                headerValues: ['Date', 'Time', 'User ID', 'Username', 'Amount', 'Description', 'Day Total']
            });
            console.log('✅ Created Expenses sheet');
        }
        
        // Cek apakah sheet "Daily Summary" sudah ada
        let summarySheet = doc.sheetsByTitle['Daily Summary'];
        
        if (!summarySheet) {
            summarySheet = await doc.addSheet({
                title: 'Daily Summary',
                headerValues: ['Date', 'User ID', 'Username', 'Total Amount', 'Transaction Count']
            });
            console.log('✅ Created Daily Summary sheet');
        }
        
    } catch (error) {
        console.error('Error setting up sheets structure:', error);
    }
}

// Fungsi untuk menyimpan ke Google Sheets
async function saveToGoogleSheets(userId, username, amount, description) {
    if (!doc) return false;
    
    try {
        const expenseSheet = doc.sheetsByTitle['Expenses'];
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        
        // Hitung total hari ini untuk user
        const todayTotal = await getTodayTotalFromSheets(userId, date);
        const newTotal = todayTotal + parseFloat(amount);
        
        // Tambah baris baru
        await expenseSheet.addRow({
            'Date': date,
            'Time': time,
            'User ID': userId,
            'Username': username || 'Unknown',
            'Amount': parseFloat(amount),
            'Description': description,
            'Day Total': newTotal
        });
        
        // Update daily summary
        await updateDailySummary(userId, username, date);
        
        return true;
    } catch (error) {
        console.error('Error saving to Google Sheets:', error);
        return false;
    }
}

// Fungsi untuk mendapatkan total hari ini dari sheets
async function getTodayTotalFromSheets(userId, date) {
    if (!doc) return 0;
    
    try {
        const expenseSheet = doc.sheetsByTitle['Expenses'];
        await expenseSheet.loadCells();
        
        const rows = await expenseSheet.getRows();
        let total = 0;
        
        rows.forEach(row => {
            if (row.get('Date') === date && row.get('User ID') === userId) {
                total += parseFloat(row.get('Amount')) || 0;
            }
        });
        
        return total;
    } catch (error) {
        console.error('Error getting today total from sheets:', error);
        return 0;
    }
}

// Update daily summary
async function updateDailySummary(userId, username, date) {
    if (!doc) return;
    
    try {
        const summarySheet = doc.sheetsByTitle['Daily Summary'];
        const expenseSheet = doc.sheetsByTitle['Expenses'];
        
        // Hitung total dan jumlah transaksi hari ini
        const rows = await expenseSheet.getRows();
        let total = 0;
        let count = 0;
        
        rows.forEach(row => {
            if (row.get('Date') === date && row.get('User ID') === userId) {
                total += parseFloat(row.get('Amount')) || 0;
                count++;
            }
        });
        
        // Cek apakah summary untuk hari ini sudah ada
        const summaryRows = await summarySheet.getRows();
        let existingRow = summaryRows.find(row => 
            row.get('Date') === date && row.get('User ID') === userId
        );
        
        if (existingRow) {
            // Update existing row
            existingRow.set('Total Amount', total);
            existingRow.set('Transaction Count', count);
            await existingRow.save();
        } else {
            // Add new row
            await summarySheet.addRow({
                'Date': date,
                'User ID': userId,
                'Username': username || 'Unknown',
                'Total Amount': total,
                'Transaction Count': count
            });
        }
        
    } catch (error) {
        console.error('Error updating daily summary:', error);
    }
}

// Fungsi untuk mendapatkan data dari sheets
async function getExpensesFromSheets(userId, days = 1) {
    if (!doc) return null;
    
    try {
        const expenseSheet = doc.sheetsByTitle['Expenses'];
        const rows = await expenseSheet.getRows();
        
        const today = new Date();
        const targetDate = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
        
        const userExpenses = rows.filter(row => {
            const rowDate = new Date(row.get('Date'));
            return row.get('User ID') === userId && rowDate >= targetDate;
        });
        
        return userExpenses.map(row => ({
            date: row.get('Date'),
            time: row.get('Time'),
            amount: parseFloat(row.get('Amount')),
            description: row.get('Description')
        }));
        
    } catch (error) {
        console.error('Error getting expenses from sheets:', error);
        return null;
    }
}

// Fungsi untuk export data ke sheets (manual sync)
async function exportAllDataToSheets(userId) {
    if (!doc) return false;
    
    try {
        const localData = await readExpenses();
        if (!localData[userId]) return false;
        
        const expenseSheet = doc.sheetsByTitle['Expenses'];
        
        for (const [date, dayExpenses] of Object.entries(localData[userId])) {
            for (const expense of dayExpenses) {
                const expenseDate = new Date(expense.timestamp);
                const time = expenseDate.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
                
                await expenseSheet.addRow({
                    'Date': date,
                    'Time': time,
                    'User ID': userId,
                    'Username': 'Imported',
                    'Amount': expense.amount,
                    'Description': expense.description,
                    'Day Total': expense.amount
                });
            }
        }
        
        return true;
    } catch (error) {
        console.error('Error exporting to sheets:', error);
        return false;
    }
}

// Inisialisasi file data lokal
async function initializeDataFile() {
    try {
        await fs.access(DATA_FILE);
    } catch (error) {
        await fs.writeFile(DATA_FILE, JSON.stringify({}));
    }
}

// Fungsi untuk membaca data pengeluaran lokal
async function readExpenses() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// Fungsi untuk menyimpan data pengeluaran lokal
async function saveExpenses(expenses) {
    await fs.writeFile(DATA_FILE, JSON.stringify(expenses, null, 2));
}

// Fungsi untuk mendapatkan tanggal hari ini
function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

// Fungsi untuk format currency IDR
function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR'
    }).format(amount);
}

// Fungsi untuk menambah pengeluaran (hybrid: lokal + sheets)
async function addExpense(userId, username, amount, description) {
    // Simpan ke lokal (backup)
    const expenses = await readExpenses();
    const today = getTodayString();
    
    if (!expenses[userId]) {
        expenses[userId] = {};
    }
    
    if (!expenses[userId][today]) {
        expenses[userId][today] = [];
    }
    
    expenses[userId][today].push({
        amount: parseFloat(amount),
        description: description,
        timestamp: new Date().toISOString()
    });
    
    await saveExpenses(expenses);
    
    // Simpan ke Google Sheets
    const sheetsSuccess = await saveToGoogleSheets(userId, username, amount, description);
    
    return sheetsSuccess;
}

// Command /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `🏦 *Selamat datang di Expense Tracker Bot\\!*

Bot ini akan mencatat pengeluaran Anda ke Google Sheets secara otomatis\\.

*Cara menggunakan:*
• Ketik jumlah dan deskripsi: 50000 makan siang
• /hari \\- Lihat pengeluaran hari ini
• /minggu \\- Lihat pengeluaran minggu ini
• /export \\- Export data lokal ke Google Sheets
• /sheets \\- Dapatkan link Google Sheets
• /help \\- Bantuan

*Fitur Google Sheets:*
✅ Auto\\-sync setiap pengeluaran
✅ Daily summary otomatis
✅ Data backup lokal
✅ Export manual jika diperlukan`;
    
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'MarkdownV2' });
});

// Command /help
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `📋 *Bantuan Expense Tracker Bot*

*Format input pengeluaran:*
Ketik: jumlah spasi deskripsi
Contoh: 50000 makan siang

*Perintah yang tersedia:*
/start \\- Pesan selamat datang
/hari \\- Lihat pengeluaran hari ini
/minggu \\- Lihat pengeluaran minggu ini
/export \\- Export data lokal ke Google Sheets
/sheets \\- Link ke Google Sheets
/help \\- Bantuan ini

*Tips:*
• Pastikan format angka tanpa titik atau koma
• Deskripsi bisa lebih dari satu kata
• Data otomatis tersimpan ke Google Sheets`;
    
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'MarkdownV2' });
});

// Command /sheets - Berikan link ke Google Sheets
bot.onText(/\/sheets/, async (msg) => {
    const chatId = msg.chat.id;
    
    if (!GOOGLE_SHEET_ID || GOOGLE_SHEET_ID === 'YOUR_GOOGLE_SHEET_ID') {
        bot.sendMessage(chatId, '❌ Google Sheets belum dikonfigurasi\\.');
        return;
    }
    
    const sheetsUrl = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}`;
    const message = `📊 *Google Sheets Anda:*

${sheetsUrl}

*Sheets yang tersedia:*
• Expenses \\- Detail semua pengeluaran
• Daily Summary \\- Ringkasan harian`;
    
    bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
});

// Command /export - Export data lokal ke sheets
bot.onText(/\/export/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    if (!doc) {
        bot.sendMessage(chatId, '❌ Google Sheets tidak tersedia\\.');
        return;
    }
    
    bot.sendMessage(chatId, '⏳ Mengexport data ke Google Sheets\\.\\.\\.');
    
    try {
        const success = await exportAllDataToSheets(userId);
        if (success) {
            bot.sendMessage(chatId, '✅ Data berhasil diexport ke Google Sheets\\!');
        } else {
            bot.sendMessage(chatId, '❌ Tidak ada data untuk diexport\\.');
        }
    } catch (error) {
        bot.sendMessage(chatId, '❌ Terjadi kesalahan saat export data\\.');
        console.error('Export error:', error);
    }
});

// Command /hari - Prioritas dari Google Sheets, fallback ke lokal
bot.onText(/\/hari/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    try {
        // Coba ambil dari Google Sheets dulu
        let todayExpenses = await getExpensesFromSheets(userId, 1);
        
        // Fallback ke data lokal jika sheets tidak tersedia
        if (!todayExpenses) {
            const expenses = await readExpenses();
            const today = getTodayString();
            todayExpenses = expenses[userId]?.[today] || [];
            todayExpenses = todayExpenses.map(exp => ({
                date: today,
                time: new Date(exp.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                amount: exp.amount,
                description: exp.description
            }));
        }
        
        if (todayExpenses.length === 0) {
            bot.sendMessage(chatId, '📝 Belum ada pengeluaran hari ini\\.');
            return;
        }
        
        // Filter hanya hari ini
        const today = getTodayString();
        const todayOnly = todayExpenses.filter(exp => exp.date === today);
        const total = todayOnly.reduce((sum, exp) => sum + exp.amount, 0);
        
        let message = `📅 *Pengeluaran Hari Ini \\(${escapeMarkdown(today)}\\)*\n\n`;
        
        todayOnly.forEach((expense, index) => {
            const formattedAmount = escapeMarkdown(formatCurrency(expense.amount));
            const escapedDesc = escapeMarkdown(expense.description);
            const escapedTime = escapeMarkdown(expense.time);
            message += `${index + 1}\\. ${formattedAmount} \\- ${escapedDesc} \\(${escapedTime}\\)\n`;
        });
        
        const formattedTotal = escapeMarkdown(formatCurrency(total));
        message += `\n💰 *Total: ${formattedTotal}*`;
        message += doc ? '\n📊 *Data dari Google Sheets*' : '\n💾 *Data dari penyimpanan lokal*';
        
        bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
    } catch (error) {
        bot.sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil data\\.');
        console.error('Error getting today expenses:', error);
    }
});

// Command /minggu - Lihat pengeluaran minggu ini
bot.onText(/\/minggu/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    
    try {
        // Coba ambil dari Google Sheets dulu
        let weekExpenses = await getExpensesFromSheets(userId, 7);
        
        // Fallback ke data lokal jika sheets tidak tersedia
        if (!weekExpenses) {
            const expenses = await readExpenses();
            weekExpenses = [];
            
            // Ambil data 7 hari terakhir
            for (let i = 0; i < 7; i++) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateString = date.toISOString().split('T')[0];
                
                if (expenses[userId]?.[dateString]) {
                    expenses[userId][dateString].forEach(exp => {
                        weekExpenses.push({
                            date: dateString,
                            time: new Date(exp.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
                            amount: exp.amount,
                            description: exp.description
                        });
                    });
                }
            }
        }
        
        if (weekExpenses.length === 0) {
            bot.sendMessage(chatId, '📝 Belum ada pengeluaran minggu ini\\.');
            return;
        }
        
        // Group by date
        const groupedByDate = {};
        weekExpenses.forEach(exp => {
            if (!groupedByDate[exp.date]) {
                groupedByDate[exp.date] = [];
            }
            groupedByDate[exp.date].push(exp);
        });
        
        let message = `📅 *Pengeluaran Minggu Ini*\n\n`;
        let grandTotal = 0;
        
        Object.keys(groupedByDate)
            .sort((a, b) => new Date(b) - new Date(a))
            .forEach(date => {
                const dayExpenses = groupedByDate[date];
                const dayTotal = dayExpenses.reduce((sum, exp) => sum + exp.amount, 0);
                grandTotal += dayTotal;
                
                const escapedDate = escapeMarkdown(date);
                const escapedTotal = escapeMarkdown(formatCurrency(dayTotal));
                message += `*${escapedDate}* \\- ${escapedTotal}\n`;
                
                dayExpenses.forEach(exp => {
                    const formattedAmount = escapeMarkdown(formatCurrency(exp.amount));
                    const escapedDesc = escapeMarkdown(exp.description);
                    message += `  • ${formattedAmount} \\- ${escapedDesc}\n`;
                });
                message += '\n';
            });
        
        const formattedGrandTotal = escapeMarkdown(formatCurrency(grandTotal));
        message += `💰 *Total Minggu: ${formattedGrandTotal}*`;
        message += doc ? '\n📊 *Data dari Google Sheets*' : '\n💾 *Data dari penyimpanan lokal*';
        
        bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
    } catch (error) {
        bot.sendMessage(chatId, '❌ Terjadi kesalahan saat mengambil data\\.');
        console.error('Error getting week expenses:', error);
    }
});

// Handler untuk menambah pengeluaran
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || msg.from.first_name;
    const text = msg.text;
    
    // Skip jika pesan adalah command
    if (text.startsWith('/')) return;
    
    // Parse pesan untuk mendapatkan jumlah dan deskripsi
    const parts = text.trim().split(' ');
    const amount = parts[0];
    const description = parts.slice(1).join(' ');
    
    // Validasi input
    if (!amount || !description || isNaN(amount) || parseFloat(amount) <= 0) {
        bot.sendMessage(chatId, 
            '❌ Format tidak valid\\. Gunakan: \\[jumlah\\] \\[deskripsi\\]\nContoh: 50000 makan siang',
            { parse_mode: 'MarkdownV2' }
        );
        return;
    }
    
    try {
        const sheetsSuccess = await addExpense(userId, username, amount, description);
        
        // Hitung total (prioritas dari sheets)
        let total;
        if (doc) {
            total = await getTodayTotalFromSheets(userId, getTodayString());
        } else {
            const expenses = await readExpenses();
            const today = getTodayString();
            total = expenses[userId]?.[today]?.reduce((sum, exp) => sum + exp.amount, 0) || 0;
        }
        
        let statusIcon = sheetsSuccess ? '📊' : '💾';
        let statusText = sheetsSuccess ? 'Google Sheets' : 'penyimpanan lokal';
        
        const formattedAmount = escapeMarkdown(formatCurrency(parseFloat(amount)));
        const escapedDesc = escapeMarkdown(description);
        const formattedTotal = escapeMarkdown(formatCurrency(total));
        const escapedStatus = escapeMarkdown(statusText);
        
        bot.sendMessage(chatId, 
            `✅ Pengeluaran berhasil dicatat\\!\n\n` +
            `💰 ${formattedAmount} \\- ${escapedDesc}\n` +
            `📊 Total hari ini: ${formattedTotal}\n` +
            `${statusIcon} Disimpan ke ${escapedStatus}`,
            { parse_mode: 'MarkdownV2' }
        );
    } catch (error) {
        bot.sendMessage(chatId, '❌ Terjadi kesalahan saat menyimpan pengeluaran\\.');
        console.error('Error adding expense:', error);
    }
});

// Error handling
bot.on('error', (error) => {
    console.error('Bot error:', error);
});

// Polling error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Inisialisasi dan start bot
async function startBot() {
    await initializeDataFile();
    await initializeGoogleSheets();
    console.log('🤖 Expense Tracker Bot is running...');
    console.log('📱 Bot siap menerima pesan!');
}

startBot().catch(console.error);