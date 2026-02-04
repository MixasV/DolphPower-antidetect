(function() {
  if (window.__dolfJarvisRecorder) return;
  
  const events = [];
  let isRecording = false;

  window.__dolfJarvisRecorder = {
    start: () => {
      isRecording = true;
      console.log('Jarvis Recording started...');
      events.push({ type: 'log', message: 'Recording started/resumed at ' + new Date().toISOString() });
    },
    pause: () => {
      isRecording = false;
      console.log('Jarvis Recording paused.');
      events.push({ type: 'log', message: 'Recording paused at ' + new Date().toISOString() });
    },
    stop: () => {
      isRecording = false;
      console.log('Jarvis Recording stopped.');
      return events;
    },
    isRecording: () => isRecording,
    getEvents: () => events,
    clearEvents: () => { events.length = 0; }
  };

  const getSelector = (el) => {
    if (el.id) return `#${el.id}`;
    if (el.name) return `[name="${el.name}"]`;
    
    let path = [];
    while (el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.className) {
        const classes = Array.from(el.classList).filter(c => !c.includes('hover') && !c.includes('active'));
        if (classes.length > 0) {
            selector += '.' + classes.join('.');
        }
      }
      let sibling = el, nth = 1;
      while (sibling = sibling.previousElementSibling) {
        if (sibling.nodeName.toLowerCase() == selector.split('.')[0]) nth++;
      }
      if (nth != 1) selector += `:nth-of-type(${nth})`;
      path.unshift(selector);
      el = el.parentNode;
    }
    return path.join(' > ');
  };

  // Click listener
  document.addEventListener('click', (e) => {
    if (!isRecording) return;
    const selector = getSelector(e.target);
    events.push({
      type: 'click',
      selector: selector,
      text: e.target.innerText?.substring(0, 30),
      timestamp: Date.now()
    });
  }, true);

  // Input listener
  document.addEventListener('change', (e) => {
    if (!isRecording) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
      const selector = getSelector(e.target);
      events.push({
        type: 'input',
        selector: selector,
        value: e.target.type === 'password' ? '********' : e.target.value,
        timestamp: Date.now()
      });
    }
  }, true);

  // Navigation (initial)
  events.push({
    type: 'navigation',
    url: window.location.href,
    timestamp: Date.now()
  });

  // Scroll (debounced)
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    if (!isRecording) return;
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      events.push({
        type: 'scroll',
        y: window.scrollY,
        timestamp: Date.now()
      });
    }, 500);
  }, true);

})();
