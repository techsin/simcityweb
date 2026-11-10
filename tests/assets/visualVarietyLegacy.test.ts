/** Saved appearances from round 1, before adding rowhouse and boutique facade families. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { registerAllModels } from '../../src/assets/builders';
import { MANIFEST_BY_ID } from '../../src/assets/manifest';
import { getModelGeometry } from '../../src/assets/registry';

const EXPECTED: Record<string, string> = {
  "res_rowhouses": "e1717ae9ff5045a8b81e832200277a63bcc3d028a02467e7e5c459807eca04fa",
  "com_boutique": "8092e556778e2f1c49de3e2e4a44b924d1021fb3eb549f2872ae40365b6b6171",
  "res_walkup": "f471afca445ab1d35db39d8f670888aff87209d850329c6fb4c30039b8f75e35",
  "com_corner_store": "babedc0a813b6a2a16265b8db39f892f11739df8ade1ccdc0626680e3e800d5b",
  "com_shops_apartments": "852db29d46d0edfecf4cadff513178a91d2875c7df54a8341215e28e0a5d5bec",
  "com_office_block": "317bfb2028b1a3d1418485c4d147aa37c8625a523a304b341a7b00b1b156663d",
  "res_walkup_hip": "cda672f340f194c48bc6d5b68fe9a799e41cf3c7505d974ed00b9c817f624f11",
  "res_walkup_monitor": "74b999090d7ef5367f4d0edc75aa97a05bbf9b922a3028da0c4ec811b95029d7",
  "res_walkup_gables": "7e33b16b624c56842624226aa050403397f39410bf92f694337c778f6ad7cd85",
  "com_corner_store_hip": "50ace6eb6a18f055c77d801faad9f15485828ab200a387752f1aeef42f9b22c0",
  "com_corner_store_gable": "87af502eb2ddfbed4228604bae80f92b169b141fbb026ab8b16ad1070c2aa49a",
  "com_corner_store_steps": "002152639a792f9ebf022904181a90add117b883a744bf8e75df6d182d5f2d0e",
  "com_shops_apartments_hip": "0f79ee4b4092d727a90970a59cdbae280796e4140582a9ff2fc198d937fa4c6c",
  "com_shops_apartments_gables": "3406be3d12cafb5e96c953a8ec3c0b705a304a66f415447449b24c32e6c50bb5",
  "com_shops_apartments_terrace": "de49de5e0564ed6fd26200819ccb137352ad63e2e11c79836052ac50fb0c4ec1",
  "com_office_block_steps": "dae14791db51788c52e36b0e1da0a19b2db6357099313aa2f377cf27d91a0f80",
  "com_office_block_sawtooth": "2af4990abc08418e71ec7c6f1739912354a56082bc5b31edf57ab7b42f7065cf",
  "com_office_block_vault": "503c7532e992280cdbb61bc7763e324aa9a0e5e724751112ba444807dd478d4a"
};

registerAllModels();

describe('NEW-01 round 2 saved appearances', () => {
  it.each(Object.entries(EXPECTED))('%s keeps every original and mirrored variant byte-identical', (id, expected) => {
    const hash = createHash('sha256');
    for (let v = 0; v < MANIFEST_BY_ID[id].variants; v++) {
      const g = getModelGeometry(id, v);
      hash.update(String(v));
      for (const name of Object.keys(g.attributes).sort()) {
        const a = g.getAttribute(name);
        hash.update(`${name}:${a.itemSize}:${a.normalized}:`);
        hash.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
      }
    }
    expect(hash.digest('hex')).toBe(expected);
  });
});

