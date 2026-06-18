const bcrypt = require('bcryptjs');

const password = 'Dharshiha@2026';
const hash = '$2a$10$YdLEvmZUk.9hUlfL623KoudC9/mNJUqiL.bQ9/qTYRjngHa07/30u';

bcrypt.compare(password, hash).then(result => {
  console.log('MATCH:', result);
});