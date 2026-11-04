# Instagram profile archive + viewer

A GitHub Action crawls every post of a public Instagram profile (default: `for_everyoung10`), saves the images/videos into `docs/media/`, and writes an index to `docs/data/posts.json`. GitHub Pages serves `docs/` as a gallery viewer.

## Setup

1. Create a new GitHub repo and push this folder to it.
2. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, Folder = `/docs`.
3. **Settings → Actions → General → Workflow permissions**: *Read and write permissions*.
4. **Actions → "Crawl Instagram profile" → Run workflow.** It also runs daily and only downloads posts it hasn't seen yet.
5. Open `https://<you>.github.io/<repo>/`.

## If the crawl fails (very common)

Instagram aggressively blocks anonymous requests from datacenter IPs like GitHub's runners. If the log shows 401/403/"login required" errors, give the crawler a logged-in session, ideally from a **throwaway account**:

```bash
pip install instaloader
instaloader --login YOUR_THROWAWAY_USER          # logs in, saves a session file
base64 -w0 ~/.config/instaloader/session-YOUR_THROWAWAY_USER   # macOS: base64 -i <file>
```

Add two repo secrets (**Settings → Secrets and variables → Actions**):

- `IG_LOGIN_USER` = the throwaway username
- `IG_SESSION_B64` = the base64 output above

Large profiles may hit rate limits; the script checkpoints, so just re-run the workflow and it resumes. Use the `max_posts` input to fetch in smaller batches.

## Viewer features

- Thumbnail grid with lazy loading / infinite scroll, adjustable tile size
- **Random pick** hero on every page load ("Another one" re-rolls) and a Random button / `R` key
- Search captions, filter images/videos, sort newest / oldest / most liked / shuffled
- Lightbox: prev/next, thumbnail strip, mouse-wheel / pinch / double-click zoom, drag to pan, swipe, fullscreen, download, caption + date + likes panel, link to the original post
- Shuffle mode (next = random, prev = go back through history) and slideshow
- Carousel posts are expanded into individual items; videos play inline
- Deep links: `#v=<shortcode>_<n>` opens a specific item

Keys: `←/→` navigate · `Esc` close · `+ − 0` zoom · `Space` slideshow · `R` random/shuffle · `F` fullscreen · `I` info · `D` download

## Notes

- Scraping Instagram is against its Terms of Service, and accounts used for it can get restricted. Hence the throwaway account.
- GitHub Pages sites are public, and the photos belong to the account owner. For personal use, keep it to a private repo (Pages on private repos needs a paid plan) or run it locally: `cd docs && python -m http.server`.
- Repos have a ~1 GB soft limit; a very large profile with lots of video can exceed that.

## Local run

```bash
pip install -r requirements.txt
python scripts/crawl.py            # IG_USERNAME=... MAX_POSTS=20 to limit
cd docs && python -m http.server   # open http://localhost:8000
```
