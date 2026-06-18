const bcrypt = require('bcryptjs');

bcrypt.hash('Dharshiha@2026', 10).then(hash => {
  console.log('NEW HASH:', hash);
});
