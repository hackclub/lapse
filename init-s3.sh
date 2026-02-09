#!/bin/bash
awslocal s3 mb s3://lapse-encrypted
awslocal s3 mb s3://lapse-public

CORS_CONFIG='{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "MaxAgeSeconds": 3000
    }
  ]
}'

awslocal s3api put-bucket-cors --bucket lapse-encrypted  --cors-configuration "$CORS_CONFIG"
awslocal s3api put-bucket-cors --bucket lapse-public  --cors-configuration "$CORS_CONFIG"