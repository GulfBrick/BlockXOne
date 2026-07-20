package app

import (
	"context"

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
		ch = chain.NewEVM()
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
