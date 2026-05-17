document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get('anthropicKey', r => {
    if (r.anthropicKey) {
      document.getElementById('api-key-input').placeholder =
        '••••••••' + r.anthropicKey.slice(-4)
    }
  })

  function attemptSave() {
    const key = document.getElementById('api-key-input').value.trim()
    if (!key) return

    if (!key.startsWith('sk-ant-')) {
      const err = document.getElementById('key-error-msg')
      err.textContent = 'Key must start with sk-ant-'
      err.hidden = false
      setTimeout(() => { err.hidden = true }, 3000)
      return
    }

    chrome.storage.local.set({ anthropicKey: key }, () => {
      const input = document.getElementById('api-key-input')
      input.value = ''
      input.placeholder = '••••••••' + key.slice(-4)
      document.getElementById('key-error-msg').hidden = true
      const msg = document.getElementById('key-saved-msg')
      msg.hidden = false
      setTimeout(() => { msg.hidden = true }, 2000)
    })
  }

  document.getElementById('save-key-btn').addEventListener('click', attemptSave)

  document.getElementById('api-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptSave()
  })
})
