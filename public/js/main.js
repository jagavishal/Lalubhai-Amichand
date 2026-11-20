document.addEventListener('DOMContentLoaded', async () => {
  window.Theme?.init();          // apply saved theme before first render
  // A failed session check (server restarting, network blip) used to throw
  // here and leave the page blank — neither shell nor login ever appeared.
  // Treat it as "not signed in" so the login form is always reachable.
  let user = null;
  try {
    ({ user } = await fetch('/api/auth/session').then(r => r.json()));
  } catch (e) {
    console.error('[main] session check failed:', e);
  }
  window.currentUser = user;
  if (user) {
    document.getElementById('app-shell').style.display='flex';
    document.getElementById('login-page').style.display='none';
    window.Sidebar?.render(user);
    window.Topbar?.render(user);
    // Landing page set BEFORE the router starts: navigating after init let the
    // (slow, async) Dashboard render first and then paint over the CEO page.
    if (!window.location.hash || window.location.hash==='#') history.replaceState(null, '', '#' + window.Router.home());
    window.Router.init();
  } else {
    document.getElementById('app-shell').style.display='none';
    document.getElementById('login-page').style.display='flex';
    window.Pages?.login?.render();
  }
});
