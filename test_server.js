const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Hello'));
app.listen(3001, () => console.log('Test server running on 3001'));
setInterval(() => console.log('Heartbeat'), 5000);
