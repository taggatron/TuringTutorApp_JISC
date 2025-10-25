document.addEventListener('DOMContentLoaded', async () => {
  // Fetch CSRF token from server
  let csrfToken = '';
  try {
    const resp = await fetch('/csrf-token', { credentials: 'same-origin' });
    const data = await resp.json();
    csrfToken = data.csrfToken || '';
  } catch (e) {
    console.error('Failed to load CSRF token', e);
  }

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      const response = await fetch('/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password })
      });

      const result = await response.json();
      if (result.success) {
        // Server sets HttpOnly cookies; just redirect
        window.location.href = '/index.html';
      } else {
        alert(result.message || 'Login failed. Please check your credentials.');
      }
    });
  }

  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;

      const response = await fetch('/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password })
      });

      const result = await response.json();
      if (result.success) {
        window.location.href = '/login.html';
      } else {
        alert(result.message || 'Registration failed.');
      }
    });
  }
});
