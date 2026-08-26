package redis

import (
	"context"

	redisclient "github.com/redis/go-redis/v9"
)

type Client struct {
	Client *redisclient.Client
}

func Connect(ctx context.Context, url string) (*Client, error) {
	opts, err := redisclient.ParseURL(url)
	if err != nil {
		return nil, err
	}

	rdb := redisclient.NewClient(opts)
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, err
	}

	return &Client{Client: rdb}, nil
}

func (c *Client) Close() error {
	return c.Client.Close()
}

func (c *Client) Raw() *redisclient.Client {
	if c == nil {
		return nil
	}
	return c.Client
}
