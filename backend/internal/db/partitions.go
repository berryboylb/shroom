package db

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

func (db *DB) MaintainPartitions(ctx context.Context) {
	db.runPartitionMaintenance(ctx)

	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			db.runPartitionMaintenance(ctx)
		}
	}
}

func (db *DB) runPartitionMaintenance(ctx context.Context) {
	now := time.Now().UTC()

	// Create partitions for current month + 2 months ahead
	for i := 0; i < 3; i++ {
		month := time.Date(now.Year(), now.Month()+time.Month(i), 1, 0, 0, 0, 0, time.UTC)
		nextMonth := month.AddDate(0, 1, 0)
		partName := fmt.Sprintf("call_quality_snapshots_%s", month.Format("2006_01"))

		query := fmt.Sprintf(
			`CREATE TABLE IF NOT EXISTS %s PARTITION OF call_quality_snapshots
             FOR VALUES FROM ('%s') TO ('%s')`,
			partName,
			month.Format("2006-01-02"),
			nextMonth.Format("2006-01-02"),
		)
		if _, err := db.Pool.Exec(ctx, query); err != nil {
			slog.Error("failed to create partition", "partition", partName, "error", err)
		} else {
			slog.Debug("partition ensured", "partition", partName)
		}
	}

	// Drop partitions older than 90 days
	cutoff := now.AddDate(0, -3, 0) // ~90 days
	for i := 0; i < 6; i++ {
		month := time.Date(cutoff.Year(), cutoff.Month()-time.Month(i), 1, 0, 0, 0, 0, time.UTC)
		partName := fmt.Sprintf("call_quality_snapshots_%s", month.Format("2006_01"))

		query := fmt.Sprintf("DROP TABLE IF EXISTS %s", partName)
		if _, err := db.Pool.Exec(ctx, query); err != nil {
			slog.Error("failed to drop old partition", "partition", partName, "error", err)
		}
	}

	slog.Info("partition maintenance complete")
}
