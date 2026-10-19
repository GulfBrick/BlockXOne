-- Query-only live TEST catalog/inverse/provider-predicate proof.
-- This is NOT a business writer, identity/chain fixture, or provider acceptance.
do $amoy_archive_alchemy_proof$
declare
  targets constant jsonb:=$alchemy_pair_proof_targets$[
  {
    "oid": 24934,
    "signature": "bx1_portal.record_funding_observation(uuid,jsonb)",
    "sha": "0537e0578f0516cda9484f5ea4648af5b74e93f44fbf5b644bd76448546305fb",
    "metadata": {
      "oid": "24934",
      "proacl": [
        "postgres=X/postgres",
        "service_role=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_funding_observation",
      "prorows": 0,
      "pronargs": 2,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "eid",
        "facts"
      ],
      "proargtypes": [
        "2950",
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "funding_pair",
        "from": "and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[])",
        "to": "and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[])",
        "count": 1
      }
    ],
    "final_sha": "a76dc61a37cee8ef51fa2770ab0d1d7152467bc7000ef820c14f3a29a5e561af"
  },
  {
    "oid": 33625,
    "signature": "bx1_portal.fund_setup_observers_valid(jsonb)",
    "sha": "c9eda9d4cdf1b1e50c28e66e91911a590909e6fa49d7035e6f953bae993d001c",
    "metadata": {
      "oid": "33625",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_setup_observers_valid",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "16",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "result"
      ],
      "proargtypes": [
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "i",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "provider_members",
        "from": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com'",
        "to": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'",
        "count": 1
      },
      {
        "name": "supported_pairs",
        "from": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]",
        "to": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]",
        "count": 1
      }
    ],
    "final_sha": "a5e330b4d8d77c5bc6e3d24c123bb7ae9ac0747a6289744cf24d67384a6d8335"
  },
  {
    "oid": 36424,
    "signature": "bx1_portal.record_fund_admission(uuid,jsonb,text)",
    "sha": "22002bab1e1930ea79f32db15e76260a2e1746e448839d01b45b77cdfeae43da",
    "metadata": {
      "oid": "36424",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_admission",
      "prorows": 0,
      "pronargs": 3,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "request_id",
        "candidate",
        "admitted_manifest_hash"
      ],
      "proargtypes": [
        "2950",
        "3802",
        "25"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "ordered_admission",
        "from": "or candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'))",
        "to": "or (candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'\n          and candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.g.alchemy.com/v2')))",
        "count": 1
      }
    ],
    "final_sha": "14a917d8a77ebe165c613ed3dd632805471b6dde8b2037b1342aeb0dda3ff176"
  },
  {
    "oid": 36708,
    "signature": "bx1_portal.fund_recipient_result_shape(jsonb)",
    "sha": "6e6fa46f5383f172df9a811b7020c04effc51e7015398a6da5ccada1d1400c3f",
    "metadata": {
      "oid": "36708",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_recipient_result_shape",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": false,
      "prorettype": "16",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "result"
      ],
      "proargtypes": [
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "i",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "provider_members",
        "from": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com'",
        "to": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'",
        "count": 1
      },
      {
        "name": "supported_pairs",
        "from": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]",
        "to": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]",
        "count": 1
      }
    ],
    "final_sha": "84cefa54ec6e792231b08f22362dedbf7fdf732444d938e3a6536b81da85b295"
  },
  {
    "oid": 36709,
    "signature": "bx1_portal.record_fund_recipient_observation(jsonb,jsonb)",
    "sha": "93bdb1489699bf4dd5b554fb85fe55c2b6fd697955832a328a8844578f531a99",
    "metadata": {
      "oid": "36709",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_recipient_observation",
      "prorows": 0,
      "pronargs": 2,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "request",
        "result"
      ],
      "proargtypes": [
        "3802",
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "provider_members",
        "from": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com'",
        "to": "'https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'",
        "count": 1
      },
      {
        "name": "supported_pairs",
        "from": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]",
        "to": "urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]",
        "count": 1
      }
    ],
    "final_sha": "32de9e76002e8bff1baa821fd6e23a9fc0ee5f78dd9eac60da1c6cf1777ab69f"
  },
  {
    "oid": 38526,
    "signature": "bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)",
    "sha": "e3c353516b891c419d95f52b25cca4ed8368e313a6efa046af6a41147fb94f5a",
    "metadata": {
      "oid": "38526",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_setup_retry",
      "prorows": 0,
      "pronargs": 4,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "3802",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "preparation",
        "action",
        "request_key",
        "details"
      ],
      "proargtypes": [
        "3802",
        "25",
        "2950",
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "24138",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "ordered_retry",
        "from": "provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co'])[provider_index+1]",
        "to": "(provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co'])[provider_index+1]\n        and provider->>'url' is distinct from (array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2'])[provider_index+1])",
        "count": 1
      }
    ],
    "final_sha": "f5c9e7853e9b3815dd4edabf678055d255c2ceb02dd45c9c0bfe63f7cc544612"
  },
  {
    "oid": 38760,
    "signature": "bx1_private.fund_alignment_snapshot_valid(jsonb)",
    "sha": "25c5320755fde3f8efd3fe914a6b3cc24b46366e99dc95e001253ba470f1dd5d",
    "metadata": {
      "oid": "38760",
      "proacl": [
        "postgres=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "fund_alignment_snapshot_valid",
      "prorows": 0,
      "pronargs": 1,
      "proowner": "16388",
      "proconfig": [
        "search_path=\"\""
      ],
      "proretset": false,
      "prosecdef": true,
      "prorettype": "16",
      "prosqlbody": null,
      "prosupport": "-",
      "proargmodes": null,
      "proargnames": [
        "v"
      ],
      "proargtypes": [
        "3802"
      ],
      "proisstrict": false,
      "proparallel": "u",
      "protrftypes": null,
      "provariadic": "0",
      "provolatile": "v",
      "proleakproof": false,
      "pronamespace": "22414",
      "proallargtypes": null,
      "proargdefaults": null,
      "pronargdefaults": 0
    },
    "cuts": [
      {
        "name": "alignment_members",
        "from": "p->>'url' not in ('https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co')",
        "to": "p->>'url' not in ('https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co','https://polygon-amoy.g.alchemy.com/v2')",
        "count": 1
      },
      {
        "name": "alignment_pairs",
        "from": "return urls[1] is distinct from urls[2];",
        "to": "return urls[1] is distinct from urls[2] and (urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls = array['https://80002.rpc.thirdweb.com','https://polygon-amoy.g.alchemy.com/v2']::text[]) is true;",
        "count": 1
      }
    ],
    "final_sha": "7b314b7a47839d6f87b8798ad6629569308c3c37ddd33d243f45109f8cb47566"
  }
]$alchemy_pair_proof_targets$::jsonb;
  cases constant jsonb:=$alchemy_pair_cases$[
  {
    "name": "d+d",
    "providers": [
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "d+p",
    "providers": [
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": true,
    "ordered": true,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "d+t",
    "providers": [
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": true,
    "ordered": true,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "d+w",
    "providers": [
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "d+a",
    "providers": [
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "p+d",
    "providers": [
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": true,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "p+p",
    "providers": [
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "p+t",
    "providers": [
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "p+w",
    "providers": [
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "p+a",
    "providers": [
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "t+d",
    "providers": [
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": true,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "t+p",
    "providers": [
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "t+t",
    "providers": [
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "t+w",
    "providers": [
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": true,
    "ordered": false,
    "narrow": true,
    "narrow_ordered": false
  },
  {
    "name": "t+a",
    "providers": [
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "w+d",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "w+p",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "w+t",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": true,
    "ordered": true,
    "narrow": true,
    "narrow_ordered": true
  },
  {
    "name": "w+w",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "w+a",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": true,
    "ordered": true,
    "narrow": true,
    "narrow_ordered": true
  },
  {
    "name": "a+d",
    "providers": [
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "a+p",
    "providers": [
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy-bor-rpc.publicnode.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "a+t",
    "providers": [
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "a+w",
    "providers": [
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": true,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "a+a",
    "providers": [
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  },
  {
    "name": "foreign",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://example.invalid",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "credentials",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://user:password@polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "query",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2?key=synthetic",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "key path",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2/synthetic-key",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "http",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "http://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "extra provider",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.g.alchemy.com/v2",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "single provider",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "empty providers",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": []
  },
  {
    "name": "null URL",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": null,
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "missing URL",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "null providers",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": null
  },
  {
    "name": "null provider",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      null
    ]
  },
  {
    "name": "numeric URL",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": 80002,
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ]
  },
  {
    "name": "object providers",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false,
    "providers": {
      "url": "https://polygon-amoy.g.alchemy.com/v2"
    }
  },
  {
    "name": "missing providers",
    "valid": false,
    "ordered": false,
    "narrow": false,
    "narrow_ordered": false
  }
]$alchemy_pair_cases$::jsonb;
  metadata_cases constant jsonb:=$alchemy_pair_metadata_cases$[{"name":"number 0","field":"finalized_block_number","value":""},{"name":"number 1","field":"finalized_block_number","value":null},{"name":"number 2","field":"finalized_block_number","value":"NaN"},{"name":"number 3","field":"finalized_block_number","value":"-1"},{"name":"number 4","field":"finalized_block_number","value":"100.1"},{"name":"number 5","field":"finalized_block_number","value":100},{"name":"missing number","field":"finalized_block_number","missing":true},{"name":"hash 0","field":"finalized_block_hash","value":null},{"name":"hash 1","field":"finalized_block_hash","value":"0x1"},{"name":"hash 2","field":"finalized_block_hash","value":100},{"name":"missing hash","field":"finalized_block_hash","missing":true}]$alchemy_pair_metadata_cases$::jsonb;
  recipient_base constant jsonb:='{"version":1,"chain_id":80002,"expiry_enforced_on_chain":false,"operation_revision":1,"phase":"CREATE_IDENTITY","status":"UNKNOWN","transaction_hash":"0x1111111111111111111111111111111111111111111111111111111111111111","claim_data_hash":"0x2222222222222222222222222222222222222222222222222222222222222222","claim_id":"0x3333333333333333333333333333333333333333333333333333333333333333","operation_id":"11111111-1111-4111-8111-111111111111","expectation_hash":"4444444444444444444444444444444444444444444444444444444444444444","identity_address":"0x5555555555555555555555555555555555555555"}'::jsonb;
  target_spec jsonb;cut jsonb;metadata jsonb;sample jsonb;providers jsonb;setup_value jsonb;recipient_value jsonb;alignment_value jsonb;
  installed text;original text;rebuilt text;funding_predicate text;admission_predicate text;recipient_member text;recipient_pair text;retry_predicate text;
  source_urls text[];actual boolean;expected boolean;start_at integer;end_at integer;case_count integer:=0;cut_count integer:=0;metadata_count integer:=0;
  claims_before text:=pg_catalog.current_setting('request.jwt.claims',true);
  sub_before text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'alchemy_pair_proof_test_owner_without_claims_required' using errcode='42501';end if;
  if jsonb_array_length(targets)<>7 or jsonb_array_length(cases)<>40 then raise exception 'alchemy_pair_proof_scope_changed';end if;
  for target_spec in select value from jsonb_array_elements(targets) loop
    select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(target_spec->>'oid')::oid;
    if metadata is null or pg_catalog.to_regprocedure(target_spec->>'signature')::oid is distinct from (target_spec->>'oid')::oid
      or metadata-'prosrc' is distinct from target_spec->'metadata' then raise exception 'alchemy_pair_proof_metadata_changed';end if;
    installed:=metadata->>'prosrc';original:=installed;
    if encode(sha256(convert_to(installed,'UTF8')),'hex') is distinct from target_spec->>'final_sha' then raise exception 'alchemy_pair_proof_final_changed';end if;
    for cut in select value from jsonb_array_elements(target_spec->'cuts') with ordinality item(value,position) order by position desc loop
      if (length(original)-length(replace(original,cut->>'to','')))/length(cut->>'to')<>1 then raise exception 'alchemy_pair_proof_inverse_not_unique';end if;
      original:=replace(original,cut->>'to',cut->>'from');cut_count:=cut_count+1;
    end loop;
    if encode(sha256(convert_to(original,'UTF8')),'hex') is distinct from target_spec->>'sha' then raise exception 'alchemy_pair_proof_original_changed';end if;
    rebuilt:=original;
    for cut in select value from jsonb_array_elements(target_spec->'cuts') loop
      if (length(rebuilt)-length(replace(rebuilt,cut->>'from','')))/length(cut->>'from')<>1 then raise exception 'alchemy_pair_proof_forward_not_unique';end if;
      rebuilt:=replace(rebuilt,cut->>'from',cut->>'to');
    end loop;
    if rebuilt is distinct from installed then raise exception 'alchemy_pair_proof_rebuild_changed';end if;
    if target_spec->>'signature'='bx1_portal.record_funding_observation(uuid,jsonb)' then
      start_at:=strpos(installed,'if (source_urls is distinct from array[');
      funding_predicate:=substring(installed from start_at+3);
      end_at:=strpos(funding_predicate,' then raise exception ''funding_invalid_sources''');
      if start_at=0 or end_at=0 then raise exception 'alchemy_pair_funding_extraction';end if;
      funding_predicate:=replace(substring(funding_predicate from 1 for end_at-1),'source_urls','($1::text[])');
    elsif target_spec->>'signature'='bx1_portal.record_fund_admission(uuid,jsonb,text)' then
      start_at:=strpos(installed,'or ((candidate#>>''{observed,providers,0,url}''');
      admission_predicate:=substring(installed from start_at+3);
      end_at:=strpos(admission_predicate,E'\n    or expiry<=');
      if start_at=0 or end_at=0 then raise exception 'alchemy_pair_admission_extraction';end if;
      admission_predicate:=replace(substring(admission_predicate from 1 for end_at-1),'candidate','($1::jsonb)');
    elsif target_spec->>'signature'='bx1_portal.record_fund_recipient_observation(jsonb,jsonb)' then
      start_at:=strpos(installed,'if pg_catalog.jsonb_typeof(item->''url'')');
      recipient_member:=substring(installed from start_at+3);
      end_at:=strpos(recipient_member,E'\n   or pg_catalog.jsonb_typeof(item->''finalized_block_hash'')');
      if start_at=0 or end_at=0 then raise exception 'alchemy_pair_recipient_member_extraction';end if;
      recipient_member:=replace(substring(recipient_member from 1 for end_at-1),'item->','entry.value->');
      start_at:=strpos(installed,'if urls[1]=urls[2] or (');
      recipient_pair:=substring(installed from start_at+3);
      end_at:=strpos(recipient_pair,' then raise exception ''fund_recipient_duplicate_provider_denied''');
      if start_at=0 or end_at=0 then raise exception 'alchemy_pair_recipient_pair_extraction';end if;
      recipient_pair:=replace(substring(recipient_pair from 1 for end_at-1),'urls','($1::text[])');
    elsif target_spec->>'signature'='bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)' then
      retry_predicate:=target_spec#>>'{cuts,0,to}';
      if strpos(installed,retry_predicate)=0 then raise exception 'alchemy_pair_retry_extraction';end if;
      retry_predicate:=replace(replace(retry_predicate,'provider->','entry.value->'),'provider_index+1','entry.position::integer');
    end if;
  end loop;
  if cut_count<>11 or funding_predicate is null or admission_predicate is null or recipient_member is null
    or recipient_pair is null or retry_predicate is null then raise exception 'alchemy_pair_proof_extraction_incomplete';end if;
  for sample in select value from jsonb_array_elements(cases) loop
    providers:=sample->'providers';expected:=(sample->>'valid')::boolean;
    setup_value:=jsonb_build_object('block_number','99');
    recipient_value:=recipient_base;
    alignment_value:=jsonb_build_object('block',jsonb_build_object('number','99','hash','0x'||repeat('1',64),'timestamp','2026-10-19T00:00:00Z'));
    if sample?'providers' then
      setup_value:=setup_value||jsonb_build_object('providers',providers);
      recipient_value:=recipient_value||jsonb_build_object('providers',providers);
      alignment_value:=alignment_value||jsonb_build_object('providers',providers);
    end if;
    -- Actual JSON-only validators; no actor, writer, protected read, or claims.
    if bx1_portal.fund_setup_observers_valid(setup_value) is distinct from expected
      or bx1_portal.fund_recipient_result_shape(recipient_value) is distinct from expected
      or bx1_private.fund_alignment_snapshot_valid(alignment_value) is distinct from (sample->>'narrow')::boolean then
      raise exception 'alchemy_pair_pure_validator_case_failed: %',sample->>'name';end if;
    if jsonb_typeof(providers)='array' then
      select array_agg(entry->>'url' order by entry->>'url') into source_urls from jsonb_array_elements(providers) entry;
    else source_urls:=null;end if;
    execute 'select case when cardinality($1::text[])<>2 or $1::text[] is null then false else not ('||funding_predicate||') end'
      into actual using source_urls;
    if actual is distinct from expected then raise exception 'alchemy_pair_funding_case_failed: %',sample->>'name';end if;
    execute 'select case when jsonb_typeof($1::jsonb#>''{observed,providers}'') is distinct from ''array'' then false else not ('||admission_predicate||') end'
      into actual using jsonb_build_object('observed',jsonb_build_object('providers',providers));
    if actual is distinct from (sample->>'ordered')::boolean then raise exception 'alchemy_pair_admission_case_failed: %',sample->>'name';end if;
    -- Pair consumes a URL array; membership separately consumes original JSON.
    if jsonb_typeof(providers)='array' then
      if jsonb_array_length(providers)=2 then
        execute 'select case when exists(select 1 from jsonb_array_elements($2::jsonb) entry(value) where '||recipient_member||') then false else not ('||recipient_pair||') end'
          into actual using source_urls,providers;
      else actual:=false;end if;
    else actual:=false;end if;
    if actual is distinct from expected then raise exception 'alchemy_pair_recipient_record_case_failed: %',sample->>'name';end if;
    execute 'select case when jsonb_typeof($1::jsonb) is distinct from ''array'' then false when jsonb_array_length($1::jsonb)<>2 then false '
      ||'else not exists(select 1 from jsonb_array_elements($1::jsonb) with ordinality entry(value,position) where '||retry_predicate||') end'
      into actual using providers;
    if actual is distinct from (sample->>'narrow_ordered')::boolean then raise exception 'alchemy_pair_retry_case_failed: %',sample->>'name';end if;
    case_count:=case_count+1;
  end loop;
  for sample in select value from jsonb_array_elements(metadata_cases) loop
    providers:=jsonb_build_array(
      jsonb_build_object('url','https://80002.rpc.thirdweb.com','finalized_block_number','100','finalized_block_hash','0x'||repeat('1',64)),
      jsonb_build_object('url','https://polygon-amoy.g.alchemy.com/v2','finalized_block_number','100','finalized_block_hash','0x'||repeat('1',64)));
    if sample->>'missing'='true' then providers:=jsonb_set(providers,'{0}',(providers->0)-(sample->>'field'));
    else providers:=jsonb_set(providers,array['0',sample->>'field'],sample->'value');end if;
    if bx1_portal.fund_setup_observers_valid(jsonb_build_object('block_number','99','providers',providers)) is not false
      or bx1_portal.fund_recipient_result_shape(recipient_base||jsonb_build_object('providers',providers)) is not false
      or bx1_private.fund_alignment_snapshot_valid(jsonb_build_object('block',jsonb_build_object('number','99','hash','0x'||repeat('1',64),'timestamp','2026-10-19T00:00:00Z'),'providers',providers)) is not false then
      raise exception 'alchemy_pair_finality_metadata_case_failed: %',sample->>'name';end if;
    metadata_count:=metadata_count+1;
  end loop;
  providers:=jsonb_build_array(
    jsonb_build_object('url','https://80002.rpc.thirdweb.com','finalized_block_number','100','finalized_block_hash','0x'||repeat('1',64)),
    jsonb_build_object('url','https://polygon-amoy.g.alchemy.com/v2','finalized_block_number','100','finalized_block_hash','0x'||repeat('1',64)));
  if bx1_portal.fund_setup_observers_valid(jsonb_build_object('block_number','101','providers',providers)) is not false
    or bx1_private.fund_alignment_snapshot_valid(jsonb_build_object('block',jsonb_build_object('number','101','hash','0x'||repeat('1',64),'timestamp','2026-10-19T00:00:00Z'),'providers',providers)) is not false
    or bx1_private.fund_alignment_snapshot_valid(jsonb_build_object('block',jsonb_build_object('number','100','hash','0x'||repeat('2',64),'timestamp','2026-10-19T00:00:00Z'),'providers',providers)) is not false
    or bx1_portal.fund_setup_observers_valid(null::jsonb) is not false
    or bx1_portal.fund_recipient_result_shape(null::jsonb) is not false
    or bx1_private.fund_alignment_snapshot_valid(null::jsonb) is not false then raise exception 'alchemy_pair_finality_or_null_changed';end if;
  if case_count<>40 or metadata_count<>11 then raise exception 'alchemy_pair_proof_cases_missing';end if;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from claims_before
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from sub_before or auth.uid() is not null then
    raise exception 'alchemy_pair_proof_claims_changed';end if;
end $amoy_archive_alchemy_proof$;

/*
OPTIONAL QUERY-ONLY PRE/POST CHECKPOINT; not executed by the proof DO.
Excludes exactly the seven targets, never six or an approximate old count.
$alchemy_pair_checkpoint$
with target_ids as (
  select p.oid from pg_catalog.pg_proc p
  where p.oid in (
    'bx1_portal.record_funding_observation(uuid,jsonb)'::regprocedure,
    'bx1_portal.fund_setup_observers_valid(jsonb)'::regprocedure,
    'bx1_portal.record_fund_admission(uuid,jsonb,text)'::regprocedure,
    'bx1_portal.fund_recipient_result_shape(jsonb)'::regprocedure,
    'bx1_portal.record_fund_recipient_observation(jsonb,jsonb)'::regprocedure,
    'bx1_portal.record_fund_setup_retry(jsonb,text,uuid,jsonb)'::regprocedure,
    'bx1_private.fund_alignment_snapshot_valid(jsonb)'::regprocedure)
), target_catalog as (
 select jsonb_agg(jsonb_build_object('oid',p.oid,'signature',p.oid::regprocedure::text,
   'metadata',to_jsonb(p)-'prosrc','body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')) order by p.oid) value
 from pg_catalog.pg_proc p join target_ids t on t.oid=p.oid
), other_functions as (
 select count(*) count,encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(p) order by p.oid)::text,'[]'),'UTF8')),'hex') sha256
 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('bx1_portal','bx1_private','public','auth') and not exists(select 1 from target_ids t where t.oid=p.oid)
), tables as (
 select n.nspname schema,c.relname relation,
   query_to_xml(format('select count(*) as count,md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text)::text,''[]'')) as row_digest from %I.%I x',n.nspname,c.relname),true,false,'')::text digest
 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('bx1_portal','bx1_private','public') and c.relkind in ('r','p')
)
select clock_timestamp() observed_at,
 (select value from target_catalog) targets,
 (select jsonb_build_object('count',count,'sha256',sha256) from other_functions) non_target_functions,
 (select jsonb_agg(jsonb_build_object('schema',schema,'relation',relation,'count_and_hash',digest) order by schema,relation) from tables) business_digests,
 (select md5(coalesce(jsonb_agg(to_jsonb(r) order by oid)::text,'[]')) from pg_catalog.pg_roles r) roles_digest,
 (select md5(coalesce(jsonb_agg(to_jsonb(m) order by roleid,member,grantor)::text,'[]')) from pg_catalog.pg_auth_members m) membership_digest,
 (select md5(coalesce(jsonb_agg(to_jsonb(n) order by oid)::text,'[]')) from pg_catalog.pg_namespace n) namespace_digest,
 (select md5(coalesce(jsonb_agg(to_jsonb(t) order by oid)::text,'[]')) from pg_catalog.pg_trigger t) trigger_digest;
$alchemy_pair_checkpoint$
*/
