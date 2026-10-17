-- Query-only TEST v2 pair proof: actual pure validators and extracted pair predicates.
-- Contract E11ABDF776ACCEEE82D2F5015E55A40B2B692DF3527CE2B9DD994DB3E43A9A10.
-- No business writer, actor/session/JWT fabrication or historical evidence update.
do $amoy_archive_pair_v2_proof$
declare
  spec constant jsonb:=$archive_pair_v2_proof_spec${
  "targets": [
    {
      "oid": 24934,
      "signature": "bx1_portal.record_funding_observation(uuid,jsonb)",
      "sha": "a11984946f2ee3f35a0eee7b2158795ac45da4cf16d019bc63f265396451638a",
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
          "from": "(source_urls is distinct from array['https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.drpc.org']::text[]\n    and source_urls is distinct from array['https://polygon-amoy.drpc.org','https://polygon-amoy.gateway.tenderly.co']::text[])",
          "to": "(source_urls is distinct from array['https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.drpc.org']::text[]\n    and source_urls is distinct from array['https://polygon-amoy.drpc.org','https://polygon-amoy.gateway.tenderly.co']::text[]\n    and source_urls is distinct from array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[])",
          "count": 1
        }
      ]
    },
    {
      "oid": 33625,
      "signature": "bx1_portal.fund_setup_observers_valid(jsonb)",
      "sha": "0da53212b45ccc2780748da62054829889302e6f96e5a36279f50ba663854220",
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
          "name": "setup_member",
          "from": "entry->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co')",
          "to": "entry->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com')",
          "count": 1
        },
        {
          "name": "setup_pair",
          "from": "return urls[1]<>urls[2] and ('https://polygon-amoy.drpc.org'=any(urls)) is true;",
          "to": "return urls[1]<>urls[2] and (urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com']::text[]\n    or urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]) is true;",
          "count": 1
        }
      ]
    },
    {
      "oid": 36424,
      "signature": "bx1_portal.record_fund_admission(uuid,jsonb,text)",
      "sha": "c1df6da97579faf7306a6355d28597787e64b7f3103c45703f9b6246041cfaa4",
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
          "name": "admission_pair",
          "from": "or candidate#>>'{observed,providers,0,url}' is distinct from 'https://polygon-amoy.drpc.org'\n    or (candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy-bor-rpc.publicnode.com'\n      and candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co')",
          "to": "or ((candidate#>>'{observed,providers,0,url}' is distinct from 'https://polygon-amoy.drpc.org'\n      or (candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy-bor-rpc.publicnode.com'\n        and candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'))\n      and (candidate#>>'{observed,providers,0,url}' is distinct from 'https://80002.rpc.thirdweb.com'\n        or candidate#>>'{observed,providers,1,url}' is distinct from 'https://polygon-amoy.gateway.tenderly.co'))",
          "count": 1
        }
      ]
    },
    {
      "oid": 36708,
      "signature": "bx1_portal.fund_recipient_result_shape(jsonb)",
      "sha": "4398f905dd2e018cfd2bcf88d2e048c3be377dbde829ca4e9b8aa1f1c593b641",
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
          "name": "recipient_shape_member",
          "from": "provider->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co')",
          "to": "provider->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com')",
          "count": 1
        },
        {
          "name": "recipient_shape_pair",
          "from": "if urls[1]=urls[2] or ('https://polygon-amoy.drpc.org'=any(urls)) is not true then return false;end if;",
          "to": "if urls[1]=urls[2] or (urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com']::text[]\n    or urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]) is not true then return false;end if;",
          "count": 1
        }
      ]
    },
    {
      "oid": 36709,
      "signature": "bx1_portal.record_fund_recipient_observation(jsonb,jsonb)",
      "sha": "030f0da12f9a7b2ebc135a5df2d2ac9845c4c27a4c3667435f7c0337dcdb6f13",
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
          "name": "recipient_record_member",
          "from": "item->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co')",
          "to": "item->>'url' not in ('https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com','https://polygon-amoy.gateway.tenderly.co','https://80002.rpc.thirdweb.com')",
          "count": 1
        },
        {
          "name": "recipient_record_pair",
          "from": "if urls[1]=urls[2] or ('https://polygon-amoy.drpc.org'=any(urls)) is not true then raise exception 'fund_recipient_duplicate_provider_denied';end if;",
          "to": "if urls[1]=urls[2] or (urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy-bor-rpc.publicnode.com']::text[]\n    or urls @> array['https://polygon-amoy.drpc.org','https://polygon-amoy.gateway.tenderly.co']::text[]\n    or urls @> array['https://80002.rpc.thirdweb.com','https://polygon-amoy.gateway.tenderly.co']::text[]) is not true then raise exception 'fund_recipient_duplicate_provider_denied';end if;",
          "count": 1
        }
      ]
    }
  ],
  "dependency": {
    "oid": 31534,
    "signature": "bx1_portal.record_fund_observation(uuid,jsonb)",
    "sha": "59f356c8435b06d174bdd104563b0d471cd36772bfbf5c13ff14dac68a140bdf",
    "metadata": {
      "oid": "31534",
      "proacl": [
        "postgres=X/postgres",
        "bx1_fund_execution_worker=X/postgres"
      ],
      "probin": null,
      "procost": 100,
      "prokind": "f",
      "prolang": "13619",
      "proname": "record_fund_observation",
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
        "oid",
        "observation"
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
    }
  }
}$archive_pair_v2_proof_spec$::jsonb;
  cases constant jsonb:=$archive_pair_v2_cases$[
  {
    "name": "dRPC/dRPC",
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
    "ordered": false
  },
  {
    "name": "dRPC/PublicNode",
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
    "ordered": true
  },
  {
    "name": "dRPC/Tenderly",
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
    "ordered": true
  },
  {
    "name": "dRPC/thirdweb",
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
    "ordered": false
  },
  {
    "name": "PublicNode/dRPC",
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
    "ordered": false
  },
  {
    "name": "PublicNode/PublicNode",
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
    "ordered": false
  },
  {
    "name": "PublicNode/Tenderly",
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
    "ordered": false
  },
  {
    "name": "PublicNode/thirdweb",
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
    "ordered": false
  },
  {
    "name": "Tenderly/dRPC",
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
    "ordered": false
  },
  {
    "name": "Tenderly/PublicNode",
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
    "ordered": false
  },
  {
    "name": "Tenderly/Tenderly",
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
    "ordered": false
  },
  {
    "name": "Tenderly/thirdweb",
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
    "ordered": false
  },
  {
    "name": "thirdweb/dRPC",
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
    "ordered": false
  },
  {
    "name": "thirdweb/PublicNode",
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
    "ordered": false
  },
  {
    "name": "thirdweb/Tenderly",
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
    "ordered": true
  },
  {
    "name": "thirdweb/thirdweb",
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
    "ordered": false
  },
  {
    "name": "foreign",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://rpc.example.invalid",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "credentials",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://name:secret@polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "query",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.gateway.tenderly.co?key=fixture",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "path",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "https://polygon-amoy.gateway.tenderly.co/unapproved",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "http",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      {
        "url": "http://polygon-amoy.gateway.tenderly.co",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "extra provider",
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
      },
      {
        "url": "https://polygon-amoy.drpc.org",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "single provider",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "empty providers",
    "providers": [],
    "valid": false,
    "ordered": false
  },
  {
    "name": "null URL",
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
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "missing URL",
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
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "null providers",
    "providers": null,
    "valid": false,
    "ordered": false
  },
  {
    "name": "null provider",
    "providers": [
      {
        "url": "https://80002.rpc.thirdweb.com",
        "finalized_block_number": "100",
        "finalized_block_hash": "0x1111111111111111111111111111111111111111111111111111111111111111"
      },
      null
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "numeric URL",
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
    ],
    "valid": false,
    "ordered": false
  },
  {
    "name": "object providers",
    "providers": {
      "url": "https://80002.rpc.thirdweb.com"
    },
    "valid": false,
    "ordered": false
  },
  {
    "name": "missing providers",
    "valid": false,
    "ordered": false
  }
]$archive_pair_v2_cases$::jsonb;
  metadata_cases constant jsonb:=$archive_pair_v2_metadata_cases$[{"name":"number 0","field":"finalized_block_number","value":null},{"name":"number 1","field":"finalized_block_number","value":""},{"name":"number 2","field":"finalized_block_number","value":"NaN"},{"name":"number 3","field":"finalized_block_number","value":"-1"},{"name":"number 4","field":"finalized_block_number","value":"100.1"},{"name":"number 5","field":"finalized_block_number","value":100},{"name":"missing number","field":"finalized_block_number","missing":true},{"name":"hash 0","field":"finalized_block_hash","value":null},{"name":"hash 1","field":"finalized_block_hash","value":"0x1"},{"name":"hash 2","field":"finalized_block_hash","value":100},{"name":"missing hash","field":"finalized_block_hash","missing":true}]$archive_pair_v2_metadata_cases$::jsonb;
  recipient_base constant jsonb:='{"version":1,"chain_id":80002,"expiry_enforced_on_chain":false,"operation_revision":1,"phase":"CREATE_IDENTITY","status":"UNKNOWN","transaction_hash":"0x1111111111111111111111111111111111111111111111111111111111111111","claim_data_hash":"0x2222222222222222222222222222222222222222222222222222222222222222","claim_id":"0x3333333333333333333333333333333333333333333333333333333333333333","operation_id":"11111111-1111-4111-8111-111111111111","expectation_hash":"4444444444444444444444444444444444444444444444444444444444444444","identity_address":"0x5555555555555555555555555555555555555555"}'::jsonb;
  target_spec jsonb;cut jsonb;metadata jsonb;sample jsonb;providers jsonb;setup_value jsonb;recipient_value jsonb;
  installed text;original text;rebuilt text;funding_predicate text;admission_predicate text;recipient_member text;recipient_pair text;
  source_urls text[];actual boolean;expected boolean;start_at integer;end_at integer;case_count integer:=0;cut_count integer:=0;metadata_count integer:=0;
  claims_before text:=pg_catalog.current_setting('request.jwt.claims',true);
  sub_before text:=pg_catalog.current_setting('request.jwt.claim.sub',true);
begin
  if current_user<>'postgres' or session_user<>'postgres' or auth.uid() is not null
    or bx1_private.test_roleplay_environment() is not true then
    raise exception 'archive_pair_v2_proof_test_owner_without_claims_required' using errcode='42501';end if;
  if jsonb_array_length(spec->'targets')<>5 or jsonb_array_length(cases)<>31 then raise exception 'archive_pair_v2_proof_scope_changed';end if;
  select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(spec#>>'{dependency,oid}')::oid;
  if metadata-'prosrc' is distinct from spec#>'{dependency,metadata}'
    or encode(sha256(convert_to(metadata->>'prosrc','UTF8')),'hex') is distinct from spec#>>'{dependency,sha}' then
    raise exception 'archive_pair_v2_proof_unchanged_writer_changed';end if;
  for target_spec in select value from jsonb_array_elements(spec->'targets') loop
    select to_jsonb(p) into metadata from pg_catalog.pg_proc p where p.oid=(target_spec->>'oid')::oid;
    if metadata is null or metadata-'prosrc' is distinct from target_spec->'metadata' then raise exception 'archive_pair_v2_proof_metadata_changed';end if;
    installed:=metadata->>'prosrc';original:=installed;
    for cut in select value from jsonb_array_elements(target_spec->'cuts') with ordinality item(value,position) order by position desc loop
      if (length(original)-length(replace(original,cut->>'to','')))/length(cut->>'to')<>1 then
        raise exception 'archive_pair_v2_proof_reverse_cut_not_unique';end if;
      original:=replace(original,cut->>'to',cut->>'from');cut_count:=cut_count+1;
    end loop;
    if encode(sha256(convert_to(original,'UTF8')),'hex') is distinct from target_spec->>'sha' then raise exception 'archive_pair_v2_proof_original_changed';end if;
    rebuilt:=original;
    for cut in select value from jsonb_array_elements(target_spec->'cuts') loop
      if (length(rebuilt)-length(replace(rebuilt,cut->>'from','')))/length(cut->>'from')<>1 then raise exception 'archive_pair_v2_proof_forward_cut_not_unique';end if;
      rebuilt:=replace(rebuilt,cut->>'from',cut->>'to');
    end loop;
    if rebuilt is distinct from installed then raise exception 'archive_pair_v2_proof_rebuild_changed';end if;
    if target_spec->>'oid'='24934' then
      funding_predicate:=target_spec#>>'{cuts,0,to}';
      if strpos(installed,funding_predicate)=0 then raise exception 'archive_pair_v2_proof_funding_predicate_missing';end if;
      funding_predicate:=replace(funding_predicate,'source_urls','$1::text[]');
    elsif target_spec->>'oid'='36424' then
      start_at:=strpos(installed,target_spec#>>'{cuts,0,to}');
      if start_at=0 then raise exception 'archive_pair_v2_proof_admission_predicate_missing';end if;
      admission_predicate:=substring(installed from start_at);
      end_at:=strpos(admission_predicate,E'\n    or expiry<=');
      if end_at=0 then raise exception 'archive_pair_v2_proof_admission_predicate_end_missing';end if;
      admission_predicate:=regexp_replace(substring(admission_predicate from 1 for end_at-1),'^[[:space:]]*or[[:space:]]+','');
      admission_predicate:=replace(admission_predicate,'candidate','$1::jsonb');
    elsif target_spec->>'oid'='36709' then
      recipient_member:=target_spec#>>'{cuts,0,to}';
      recipient_pair:=target_spec#>>'{cuts,1,to}';
      if strpos(installed,recipient_member)=0 or strpos(installed,recipient_pair)=0 then raise exception 'archive_pair_v2_proof_recipient_predicate_missing';end if;
      recipient_member:=replace(recipient_member,'item->>''url''','entry.url');
      recipient_pair:=split_part(split_part(recipient_pair,'if ',2),' then',1);
      recipient_pair:=replace(recipient_pair,'urls','($1::text[])');
    end if;
  end loop;
  if cut_count<>8 or funding_predicate is null or admission_predicate is null or recipient_pair is null then
    raise exception 'archive_pair_v2_proof_extraction_incomplete';end if;
  -- These are the two actual IMMUTABLE/INVOKER JSON-only validators, not writers.
  -- Existing cardinality/URL-type/finality metadata checks remain in their bodies.
  for sample in select value from jsonb_array_elements(cases) loop
    providers:=sample->'providers';expected:=(sample->>'valid')::boolean;
    setup_value:=jsonb_build_object('block_number','99');
    recipient_value:=recipient_base;
    if sample?'providers' then
      setup_value:=setup_value||jsonb_build_object('providers',providers);
      recipient_value:=recipient_value||jsonb_build_object('providers',providers);
    end if;
    if bx1_portal.fund_setup_observers_valid(setup_value) is distinct from expected
      or bx1_portal.fund_recipient_result_shape(recipient_value) is distinct from expected then
      raise exception 'archive_pair_v2_proof_pure_validator_case_failed: %',sample->>'name';end if;
    if jsonb_typeof(providers)='array' then
      select array_agg(entry->>'url' order by entry->>'url') into source_urls from jsonb_array_elements(providers) entry;
    else source_urls:=null;end if;
    execute 'select not ('||funding_predicate||')' into actual using source_urls;
    if actual is distinct from expected then raise exception 'archive_pair_v2_proof_funding_pair_case_failed: %',sample->>'name';end if;
    -- Ordered admission retains [dRPC,PublicNode] and [dRPC,Tenderly],
    -- and adds only [thirdweb,Tenderly]; unordered callers retain both orders.
    execute 'select case when jsonb_typeof($1::jsonb#>''{observed,providers}'') is distinct from ''array'' then false else not ('||admission_predicate||') end'
      into actual using jsonb_build_object('observed',jsonb_build_object('providers',providers));
    if actual is distinct from (sample->>'ordered')::boolean then raise exception 'archive_pair_v2_proof_ordered_admission_case_failed: %',sample->>'name';end if;
    execute 'select case when cardinality($1::text[])<>2 or $1::text[] is null or array_position($1::text[],null) is not null then false '
      ||'when exists(select 1 from unnest($1::text[]) entry(url) where '||recipient_member||') then false else not ('||recipient_pair||') end'
      into actual using source_urls;
    if actual is distinct from expected then raise exception 'archive_pair_v2_proof_recipient_record_pair_case_failed: %',sample->>'name';end if;
    case_count:=case_count+1;
  end loop;
  if case_count<>31 then raise exception 'archive_pair_v2_proof_cases_missing';end if;

  -- Query values exercise unchanged URL-type/finality metadata guards, not writers.
  for sample in select value from jsonb_array_elements(metadata_cases) loop
    providers:=jsonb_build_array(
      jsonb_build_object('url','https://80002.rpc.thirdweb.com','finalized_block_number','100','finalized_block_hash','0x'||repeat('1',64)),
      jsonb_build_object('url','https://polygon-amoy.gateway.tenderly.co','finalized_block_number','100','finalized_block_hash','0x'||repeat('1',64)));
    if sample->>'missing'='true' then
      providers:=jsonb_set(providers,'{0}',(providers->0)-(sample->>'field'));
    else
      providers:=jsonb_set(providers,array['0',sample->>'field'],sample->'value');
    end if;
    if bx1_portal.fund_setup_observers_valid(jsonb_build_object('block_number','99','providers',providers)) is not false
      or bx1_portal.fund_recipient_result_shape(recipient_base||jsonb_build_object('providers',providers)) is not false then
      raise exception 'archive_pair_v2_proof_metadata_case_failed: %',sample->>'name';end if;
    metadata_count:=metadata_count+1;
  end loop;
  if metadata_count<>11 then raise exception 'archive_pair_v2_proof_metadata_cases_missing';end if;
  providers:=jsonb_build_array(
    jsonb_build_object('url','https://80002.rpc.thirdweb.com','finalized_block_number','100','finalized_block_hash','0x'||repeat('1',64)),
    jsonb_build_object('url','https://polygon-amoy.gateway.tenderly.co','finalized_block_number','100','finalized_block_hash','0x'||repeat('1',64)));
  if bx1_portal.fund_setup_observers_valid(jsonb_build_object('block_number','101','providers',providers)) is not false
    or bx1_portal.fund_setup_observers_valid(null::jsonb) is not false
    or bx1_portal.fund_recipient_result_shape(null::jsonb) is not false then
    raise exception 'archive_pair_v2_proof_finality_or_null_guard_changed';end if;
  if pg_catalog.current_setting('request.jwt.claims',true) is distinct from claims_before
    or pg_catalog.current_setting('request.jwt.claim.sub',true) is distinct from sub_before or auth.uid() is not null then
    raise exception 'archive_pair_v2_proof_claims_changed';end if;
end $amoy_archive_pair_v2_proof$;
