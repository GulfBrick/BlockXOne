/** Public navigation destinations only; these never select an authentication backend. */
export const BRANDED_ENTRY = {
  mainnetLogin: '/login',
  testnetLogin: 'https://testnet.bx1.co.za/login',
  testnetRegister: 'https://testnet.bx1.co.za/register',
} as const
