// Runs first, before the page paints.
// 1. Marks that JavaScript is running, so reveal animations can start hidden.
//    Without JS (or if a script fails), everything simply stays visible.
// 2. Stops the browser restoring an old scroll position on reload or Back: the landing
//    page is a scroll-driven sequence and must always set itself up from the top.
document.documentElement.classList.add('js');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!location.hash) window.scrollTo(0, 0);
