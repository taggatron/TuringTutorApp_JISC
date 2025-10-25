const text = '[SDCGenAI]';
let index = 0;
const speed = 150; // Speed of typing

function typeWriter() {
  if (index < text.length) {
    document.getElementById('animated-text').textContent += text.charAt(index);
    index++;
    setTimeout(typeWriter, speed);
  } else {
    // Show code snippet after the text is fully typed
    setTimeout(() => {
      document.getElementById('code-snippet').style.display = 'inline';
      document.getElementById('code-snippet').textContent = ''; // Replace with actual code snippet
      setTimeout(() => {
        document.getElementById('code-snippet').style.display = 'none';
      }, 2000); // Hide after 2 seconds
    }, 500); // Wait 0.5s after typing is done
  }
}

typeWriter();
