const GetGoogleFonts = require('get-google-fonts');

const fonts = new GetGoogleFonts({
  outputDir: './public/fonts',
  cssFile: './fonts.css',
  path: '/fonts/'
});

fonts.download('https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,300..700;1,300..700&family=JetBrains+Mono:wght@400;500&display=swap')
  .then(() => {
    console.log('Fonts downloaded successfully');
  })
  .catch(err => {
    console.error('Error downloading fonts', err);
  });
