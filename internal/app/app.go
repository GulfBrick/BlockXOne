package app

import (
	"context"
	"fmt"

	"blockxone/internal/chain"
	"blockxone/internal/config"
	"blockxone/internal/db"

	"github.com/nats-io/nats.go"
)

type App struct {
	Cfg   config.Config
	DB    *db.DB
	NATS  *nats.Conn
	Chain chain.Adapter
}

func New(ctx context.Context, cfg config.Config) (*App, error) {
	if err := cfg.ValidateRuntime("app"); err != nil {
		return nil, fmt.Errorf("runtime configuration rejected: %w", err)
	}

	d, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}

	nc, err := nats.Connect(cfg.NatsURL)
	if err != nil {
		d.Close()
		return nil, err
	}

	var ch chain.Adapter
	if cfg.ChainMode == string(chain.ModeMock) {
		ch = chain.NewMock()
	} else {
		ev, err := chain.NewEVM(cfg, d)
		if err != nil {
			nc.Close()
			d.Close()
			return nil, err
		}
		ch = ev
	}

	return &App{
		Cfg:   cfg,
		DB:    d,
		NATS:  nc,
		Chain: ch,
	}, nil
}

func (a *App) Close() {
	if a.NATS != nil {
		a.NATS.Close()
	}
	if a.DB != nil {
		a.DB.Close()
	}
}
