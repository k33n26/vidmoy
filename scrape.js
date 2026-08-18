const axios = require('axios');
const fs = require('fs');
const puppeteer = require('puppeteer');

const API_KEY = process.env.TMDB_API_KEY || '5a98ac2ab1eeba8124c3f6a10f4f13ab';
const ACTOR_IMDB_URL = 'https://www.imdb.com/name/nm0200637/'; // Örn: İlyas Salman

function extractPersonId(input) {
    const match = input.match(/nm\d+/);
    return match ? match[0] : null;
}

async function getActorMovies(imdbPersonId) {
    try {
        const findUrl = `https://api.themoviedb.org/3/find/${imdbPersonId}?api_key=${API_KEY}&external_source=imdb_id`;
        const findRes = await axios.get(findUrl);
        
        const person = findRes.data.person_results[0];
        if (!person) {
            console.error("❌ Oyuncu bulunamadı!");
            return { name: "Bilinmeyen", movies: [] };
        }

        console.log(`🎬 Oyuncu Bulundu: ${person.name}`);

        const creditsUrl = `https://api.themoviedb.org/3/person/${person.id}/movie_credits?api_key=${API_KEY}&language=tr-TR`;
        const creditsRes = await axios.get(creditsUrl);

        return { name: person.name, movies: creditsRes.data.cast || [] };
    } catch (error) {
        console.error("TMDB Veri hatası:", error.message);
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

// Puppeteer ile Ağ Trafiğini Dinleme (Network Interception)
async function getRealVideoLink(browser, imdbId) {
    const vsUrl = `https://vidmody.com/vs/${imdbId}`;
    let page = null;
    let videoLink = null;

    try {
        console.log(`  🔍 ${imdbId} için Vidmody taranıyor (Puppeteer)...`);
        page = await browser.newPage();

        // Gereksiz resim ve font yüklemelerini engelleyerek hızı artır
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        // Ağ isteklerini dinle ve .m3u8 linkini yakala
        const m3u8Promise = new Promise((resolve) => {
            page.on('request', (request) => {
                const url = request.url();
                if (url.includes('.m3u8')) {
                    resolve(url);
                }
            });

            // 12 saniye içinde bulamazsa zaman aşımına uğrat
            setTimeout(() => resolve(null), 12000);
        });

        // Sayfayı ziyaret et
        await page.goto(vsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});

        // Yakalanan .m3u8 linkini bekle
        videoLink = await m3u8Promise;

        if (videoLink) {
            console.log(`  📹 .m3u8 Yakalandı: ${videoLink.substring(0, 70)}...`);
        }

    } catch (error) {
        // Hata durumunda sessizce devam et
    } finally {
        if (page) await page.close();
    }

    return videoLink;
}

async function main() {
    const personId = extractPersonId(ACTOR_IMDB_URL);
    if (!personId) {
        console.error("Geçersiz IMDb ID!");
        return;
    }

    const { name, movies } = await getActorMovies(personId);
    console.log(`📊 Toplam ${movies.length} içerik bulundu. Puppeteer başlatılıyor...\n`);

    // Puppeteer Tarayıcısını Başlat
    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
        ]
    });

    const results = [];

    for (const movie of movies) {
        const imdbFilmId = await getMovieImdbId(movie.id);
        if (!imdbFilmId) continue;

        const videoLink = await getRealVideoLink(browser, imdbFilmId);
        if (videoLink) {
            console.log(`  ✅ BULUNDU: ${movie.title} (${movie.release_date?.split('-')[0] || 'Bilinmiyor'})`);
            results.push({
                title: movie.title,
                year: movie.release_date?.split('-')[0] || 'Bilinmiyor',
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '',
                link: videoLink
            });
        }
    }

    await browser.close();

    if (!fs.existsSync('output')) {
        fs.mkdirSync('output');
    }

    if (results.length > 0) {
        let m3u = `#EXTM3U\n# Oyuncu: ${name} (${personId})\n\n`;
        for (const item of results) {
            m3u += `#EXTINF:-1 tvg-logo="${item.poster}", ${item.title} (${item.year})\n${item.link}\n`;
        }
        fs.writeFileSync(`output/${personId}_playlist.m3u`, m3u);
        console.log(`\n🎉 İşlem tamamlandı! ${results.length} film output/${personId}_playlist.m3u dosyasına kaydedildi.`);
    } else {
        console.log("\n❌ Oynatılabilir hiçbir link bulunamadı.");
    }
}

main();
