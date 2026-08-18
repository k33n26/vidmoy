const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio');

// GitHub Secret üzerinden veya doğrudan buraya TMDB API anahtarınızı tanımlayın
const API_KEY = process.env.TMDB_API_KEY || '5a98ac2ab1eeba8124c3f6a10f4f13ab';
const ACTOR_IMDB_URL = 'https://www.imdb.com/name/nm0758656/'; // Örn: Pedro Pascal

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

async function getRealVideoLink(imdbId) {
    const vsUrl = `https://vidmody.com/vs/${imdbId}`;
    try {
        console.log(`  🔍 ${imdbId} için Vidmody sorgulanıyor...`);
        const response = await axios.get(vsUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        let videoLink = null;

        const scripts = $('script').get();
        for (const script of scripts) {
            const content = $(script).html();
            if (content) {
                const matches = content.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
                if (matches && matches.length > 0) {
                    videoLink = matches[0];
                    break;
                }
            }
        }

        return videoLink;
    } catch {
        return null;
    }
}

async function main() {
    const personId = extractPersonId(ACTOR_IMDB_URL);
    if (!personId) {
        console.error("Geçersiz IMDb ID!");
        return;
    }

    const { name, movies } = await getActorMovies(personId);
    console.log(`📊 Toplam ${movies.length} içerik bulundu. Linkler taranıyor...\n`);

    const results = [];

    for (const movie of movies) {
        const imdbFilmId = await getMovieImdbId(movie.id);
        if (!imdbFilmId) continue;

        const videoLink = await getRealVideoLink(imdbFilmId);
        if (videoLink) {
            console.log(`  ✅ BULUNDU: ${movie.title} (${movie.release_date?.split('-')[0] || 'Bilinmiyor'})`);
            results.push({
                title: movie.title,
                year: movie.release_date?.split('-')[0] || 'Bilinmiyor',
                poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : '',
                link: videoLink
            });
        }
        await new Promise(r => setTimeout(r, 100)); // İstekler arası kısa bekleme
    }

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
