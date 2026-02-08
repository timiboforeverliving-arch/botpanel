const fs = require('fs');
const archiver = require('archiver');
const output = fs.createWriteStream('github_upload_package.zip');
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', function() {
  console.log(archive.pointer() + ' total bytes');
  console.log('ZIP created successfully.');
});

archive.on('error', function(err) {
  throw err;
});

archive.pipe(output);

// Add files
archive.glob('**/*', {
  ignore: [
    'node_modules/**', 
    '.git/**', 
    'session/**', 
    '*.zip', 
    'package-lock.json', 
    '.env',
    'service-account.json' // KESİNLİKLE HARİÇ TUTULMALI
  ]
});

archive.finalize();