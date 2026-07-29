// Shared visitor-badge printer — used by the kiosk (auto-print + reprint),
// the Visits page (reprint any past visit) and Devices (test print).
// Prints via a hidden sandboxed iframe so the kiosk page itself is untouched.
// The print call WAITS for the photo to decode — firing print() right after
// doc.write() was printing half-empty badges ("not populating").

export function printBadge({
  title = 'VISITOR',
  firstName = '',
  lastName = '',
  company = '',
  hostName = '',
  hostLabel = 'Visiting',
  badgeNo = '',
  photo = null,
  time = null,
}) {
  try {
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '0'; frame.style.bottom = '0';
    frame.style.width = '0'; frame.style.height = '0'; frame.style.border = '0';
    document.body.appendChild(frame);

    const stamp = time ? new Date(time) : new Date();
    const photoImg = photo
      ? `<img id="badge-photo" src="${photo}" style="width:180px;height:180px;border-radius:50%;object-fit:cover;border:4px solid #0D7377" />`
      : '';

    const doc = frame.contentWindow.document;
    doc.open();
    doc.write(`<!doctype html><html><head><title>Visitor Badge ${badgeNo}</title></head>
      <body style="margin:0;font-family:Arial,sans-serif">
        <div style="width:360px;border:3px solid #0D7377;border-radius:16px;overflow:hidden;text-align:center">
          <div style="background:#0D7377;color:#fff;padding:12px;font-size:20px;font-weight:800;letter-spacing:2px">${title}</div>
          <div style="padding:18px 14px">
            ${photoImg}
            <div style="font-size:26px;font-weight:800;color:#0F172A;margin-top:12px">${firstName} ${lastName}</div>
            ${company ? `<div style="font-size:15px;color:#475569;margin-top:2px">${company}</div>` : ''}
            ${hostName ? `<div style="font-size:15px;color:#0D7377;font-weight:700;margin-top:8px">${hostLabel}: ${hostName}</div>` : ''}
            <div style="font-size:13px;color:#64748B;margin-top:8px">${stamp.toLocaleString()}</div>
          </div>
          <div style="background:#0F172A;color:#14FFEC;padding:10px;font-size:22px;font-weight:800;font-family:monospace;letter-spacing:3px">${badgeNo}</div>
        </div>
      </body></html>`);
    doc.close();

    const doPrint = () => {
      try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      } catch (e) { /* dialog cancelled or blocked */ }
      setTimeout(() => { try { frame.remove(); } catch (e) {} }, 2000);
    };

    // Wait until the photo is decoded (or fails), with a hard cap so a slow
    // image never leaves the badge unprinted
    const img = doc.getElementById('badge-photo');
    let fired = false;
    const once = () => { if (!fired) { fired = true; doPrint(); } };
    if (img) {
      if (img.complete && img.naturalWidth > 0) once();
      else {
        img.onload = once;
        img.onerror = once;
        setTimeout(once, 1500);
      }
    } else {
      setTimeout(once, 250);
    }
    return true;
  } catch (e) {
    return false;
  }
}
