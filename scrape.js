const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Puppeteer Stealth (Bot Gizleme) Modülü
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const API_KEY = process.env.TMDB_API_KEY || '5a98ac2ab1eeba8124c3f6a10f4f13ab';
const TXT_FILE_PATH = path.join(__dirname, 'actors.txt');

function extractPersonId(input) {
    const match = input.match(/nm\d+/);
    return match ? match[0] : null;
}

function readActorsList() {
    if (!fs.existsSync(TXT_FILE_PATH)) {
        console.error("❌ actors.txt dosyası bulunamadı!");
        return [];
    }

    const content = fs.readFileSync(TXT_FILE_PATH, 'utf-8');
    const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));

    const list = [];
    for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 2) {
            const groupName = parts[0].trim();
            const url = parts[1].trim();
            const personId = extractPersonId(url);
            if (personId) {
                list.push({ groupName, personId, url });
            }
        }
    }
    return list;
}

async function getActorMovies(imdbPersonId) {
    try {
        const findUrl = `https://api.themoviedb.org/3/find/${imdbPersonId}?api_key=${API_KEY}&external_source=imdb_id`;
        const findRes = await axios.get(findUrl);
        
        const person = findRes.data.person_results[0];
        if (!person) {
            return { name: "Bilinmeyen", movies: [] };
        }

        const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/movie_credits?api_key=${API_KEY}&language=tr-TR`;
        const creditsRes = await axios.get(creditsUrl);

        return { name: person.name, movies: creditsRes.data.cast || [] };
    } catch (error) {
        console.error(`  ⚠️ TMDB Veri hatası (${imdbPersonId}):`, error.message);
        return { name: "Hata", movies: [] };
    }
}

async function getMovieImdbId(tmdbId) {
    try {
        const url = `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${API_KEY}`;
        const response = await axios.get(url);
        return response.data.imdb_id;
    } catch {
        return null;
    }
}

// Stealth Destekli Ağ Dinleyici
async function getRealVideoLink(browser, imdbId) {
    const vsUrl = `https://vidmody.com/vs/${imdbId}`;
    let page = null;
    let videoLink = null;

    try {
        page = await browser.newPage();

        // 1. Ekran Çözünürlüğü ve User Agent Ayarla
        await page.setViewport({ width: 1366, height: 768 });

        // 2. Ağ Paketlerini Dinle
        const m3u8Promise = new Promise((resolve) => {
            page.on('request', (request) => {
                const url = request.url();
                // Vidmody m3u8 ve playlist URL kalıpları
                if (url.includes('.m3u8') || url.includes('/hls/') || url.includes('/playlist/')) {
                    resolve(url);
                }
            });

            page.on('response', async (response) => {
                const url = response.url();
                if (url.includes('.m3u8') || url.includes('/hls/')) {
                    resolve(url);
                }
            });

            // 15 Saniye Bekleme Süresi
            setTimeout(() => resolve(null), 15000);
        });

        // Sayfaya git ve tamamen yüklenmesini bekle
        await page.goto(vsUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

        // Oynatıcıyı Tetiklemek için Sayfa Ortasına Tıklama
        await page.mouse.click(683, 384).catch(() => {});
        
        // Iframe varsa onun içine de tıklama yap
        const frames = page.frames();
        for (const frame of frames) {
            try {
                await frame.click('body');
            } catch (e) {}
        }

        videoLink = await m3u8Promise;

    } catch (error) {
        console.error(`  ❌ Hata (${imdbId}):`, error.message);
    } finally {
        if (page) await page.close();
    }

    return videoLink;
}

async function main() {
    const actors = readActorsList();
    if (actors.length === 0) {
        console.log("❌ actors.txt içinde geçerli oyuncu/kategori bulunamadı.");
        return;
    }

    console.log(`📋 Toplam ${actors.length} kategori/oyuncu taranacak.\n`);

    // Puppeteer'ı Stealth Modda Başlat
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1366,768'
        ]
    });

    let masterPlaylistContent = `#EXTM3U x-tvg-url=""\n\n`;
    let totalFoundCount = 0;

    for (const actor of actors) {
        console.log(`==================================================`);
        console.log(`📂 Kategori: [${actor.groupName}] (${actor.personId})`);
        
        const { movies } = await getActorMovies(actor.personId);
        console.log(`🎬 TMDB üzerinde ${movies.length} içerik bulundu. Taranıyor...`);

        let actorFoundCount = 0;

        for (const movie of movies) {
            const imdbFilmId = await getMovieImdbId(movie.id);
            if (!imdbFilmId) continue;

            process.stdout.write(`  🔍 ${movie.title} (${imdbFilmId}) kontrol ediliyor... `);
            const videoLink = await getRealVideoLink(browser, imdbFilmId);

            if (videoLink) {
                const year = movie.release_date?.split('-')[0] || 'Bilinmiyor';
                const poster = movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '';
                
                console.log(`\n  ✅ BULUNDU: ${movie.title} -> ${videoLink.substring(0, 50)}...`);

                masterPlaylistContent += `#EXTINF:-1 tvg-logo="${poster}" group-title="${actor.groupName}", ${movie.title} (${year})\n${videoLink}\n\n`;
                
                actorFoundCount++;
                totalFoundCount++;
            } else {
                console.log(`❌ Bulunamadı`);
            }
        }
        console.log(`📊 [${actor.groupName}] için ${actorFoundCount} video linki eklendi.\n`);
    }

    await browser.close();

    if (!fs.existsSync('output')) {
        fs.mkdirSync('output');
    }

    if (totalFoundCount > 0) {
        const outputPath = 'output/playlist.m3u';
        fs.writeFileSync(outputPath, masterPlaylistContent);
        console.log(`\n🎉 BÜTÜN İŞLEMLER TAMAMLANDI!`);
        console.log(`📁 Toplam ${totalFoundCount} film '${outputPath}' dosyasına kaydedildi.`);
    } else {
        console.log("\n❌ Taranan kategorilerde hiç oynatılabilir link bulunamadı.");
    }
}

main();
