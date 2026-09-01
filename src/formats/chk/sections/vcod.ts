/**
 * VCOD: the verification table StarCraft checks a scenario against on load — 256 u32 seeds
 * and 16 opcode bytes. StarEdit writes the same fixed table into every map it creates
 * (both Blizzard maps in `fixtures/` carry it byte for byte), so a new scenario gets that
 * one; a map without a VCOD the game recognises does not load.
 */
export const VCOD_SIZE = 1040;

const DEFAULT_VCOD_BASE64 =
  "NBnKd5ncaHEKYL/Dp+d1px8pfabXsDq7zDEk7RdMEwtlIKK3kb0Ya43DXd3ietU39llk1GOaEg9DXC5G43T4KghqNwY39tY7DpRjFkVnXOzXe/e3GvzUnnP6P4wuwOEP0XQJB5XjZNd1Fmh0madP2tUgGB/n5qC+prbjH8oM73Ax1RoxTbgkNeP4x33hGlje9AUnQ7qs2wfcab4KqI/sSddYFj/l28GKQc/ABZ3KHHKisV+lxCNwm4QE4RSAe5Da+ttpBqPzD0C+887U48nL11pAATTyaBT4OI7FGv7WPUtTBQX6NBBFjt2Raf6v4O7w80h+3Z+t3HVieqzlMRtiZyDNNk3gmCF0+wl5cTZnzX93X9Y8oqKmxhrjzmpOzalshrqdO7X0dv34RPC8LuluKSMlL2sIqydEehLMme3c8nXFPDh+9xwbxdEtlGUGyUjdvjItrLXJMoFmStg0NT8V37Lu67YE9k2WNUKUnGKK02FSqHtv3GH89GwULf6Z6qQK6Nn+E9BIRFmAZvPjNNmNGRbXY/4wGH46m40PsRLw9YwKeFjbPmO4jDqq8443ihouXDH57+Nt436bvT4TxkTAubw62pCkrbB0+FcniUfmPzfkQnla30ON7rQKSeg8w4gaiAFrdorD/aMWek5Wp3/LugJeHOywucl2HoKxOT7JV8UZJDhMXS9UuG9dV44woQpSbRhxXhMGw1kf3D5i3Nq16xuRlfmnkdXaM1POa/UAcAF/2O7owArxzmPrttN478ylql28pJar8tJh/+qaqGrtor0+7WE5wYKSFjYjsbCgJOUFm6eqDRKbM4OSINolsOz8JNA4I/yV8nSAc+UZl1B9REWTRNuirR1pRBTu5yx/h/84njLxTbwp2kInJv7B0iup9kJ6DsvofNEPW+xWabdhMbRt+SVANHlt+lOnC/qkgs7DRUlhDUUsjyhJYPfzfckeD9CJwSZS+NNNjzUUup1fCwepSgD3IiYvPmf7H6GcEcZpT11mWDQVkGzlVEavX2PWigyV370N5K+/QEBMo/ZRcSntJviFKCLVv77P+ijFf1G4BmMH7L2PKfpVfnEaQDJm6NTendRe/JN6PdU7zXUugApPdIcbzI/qmqnbfBZT5e+reMFupHKJWpgscFD7od8fa7fZRAeAglb9v8CDDknQWx5oag6awgsvjkOg4ZkM9rLgehxeLMigRTwL6YisuZbGdK6DKrsT+mXrTx+msIqK4YHpuLnVVRVORfKtmz7CNX5fki5ytltoI27GRQ7pO4fU9EHA46gFRL7kD4oTGsQ39FpAVe+deR1LSnk6nHaFN8yCPQ+2YKaTfr1cwsRyx3+QTRuWEBMFaGg1wHv/RoVDKgEEBQYCAQUCAAMHBwUEBgM=";

let cached: Uint8Array | null = null;

/** StarEdit's verification table, freshly copied. */
export function defaultVcod(): Uint8Array {
  if (!cached) {
    const bin = atob(DEFAULT_VCOD_BASE64);
    cached = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) cached[i] = bin.charCodeAt(i);
  }
  return cached.slice();
}
