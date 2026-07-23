module github.com/vertikar/finance-api

go 1.22

require (
	github.com/DATA-DOG/go-sqlmock v1.5.0
	github.com/go-chi/chi/v5 v5.1.0
	github.com/go-chi/cors v1.2.1
	github.com/golang-jwt/jwt/v5 v5.2.1
	github.com/golang-migrate/migrate/v4 v4.17.1
	github.com/lib/pq v1.10.9
	golang.org/x/crypto v0.24.0
)

require (
	github.com/hashicorp/errwrap v1.1.0 // indirect
	github.com/hashicorp/go-multierror v1.1.1 // indirect
	go.uber.org/atomic v1.7.0 // indirect
)

replace (
	go.uber.org/atomic => github.com/uber-go/atomic v1.7.0
	golang.org/x/crypto => github.com/golang/crypto v0.24.0
	golang.org/x/mod => github.com/golang/mod v0.11.0
	golang.org/x/net => github.com/golang/net v0.21.0
	golang.org/x/sys => github.com/golang/sys v0.21.0
	golang.org/x/tools => github.com/golang/tools v0.10.0
	gopkg.in/yaml.v3 => github.com/go-yaml/yaml v3.0.1+incompatible
)
