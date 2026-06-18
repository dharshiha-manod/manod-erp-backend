const bcrypt = require('bcryptjs');

const password = 'Dharshiha@2026';
const hash = '$2a$10$O2Cu9xGWYsg6T5qIoLs4jOaWGWWu7j3Pjanx9kg2Je/SvRCv7kGGi';

bcrypt.compare(password, hash).then(result => {
  console.log('MATCH:', result);
});
