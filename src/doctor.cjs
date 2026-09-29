module.exports = { doctor: (...args) => import('./doctor.js').then(m => m.doctor(...args)) }
