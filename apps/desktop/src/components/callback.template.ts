export default `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
  <meta http-equiv="Pragma" content="no-cache">
  <title>NeoCap Auth</title>
  <style>
    html, body { width: 100%; height: 100%; margin: 0; padding: 0; font-weight: 400; }
    body { display: flex; align-items: center; justify-content: center; font-family: sans-serif; text-align: center; background-color: #f8f9fa; }
    .container { padding: 30px; width: 100%; max-width: 400px; margin: 0 auto; }
    .brand { display: inline-flex; align-items: center; gap: 10px; margin-bottom: 20px; color: #12161F; font-size: 32px; font-weight: 600; letter-spacing: -1.5px; }
    .mark { width: 40px; height: 40px; border-radius: 8px; border: 1px solid #E7EAF0; background: radial-gradient(circle at center, white 0 27%, #ADC9FF 28% 47%, #4785FF 48% 62%, white 63%); }
    p { font-size: 21px; line-height: 26px; color: #12161F; margin: 0; }
    .error { color: #dc2626; margin-top: 12px; font-size: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="brand"><span class="mark"></span><span>NeoCap</span></div>
    <p id="message">You are now signed in. Please re-open the NeoCap desktop app to continue.</p>
    <div id="error-container"></div>
  </div>
</body>
</html>
`;
