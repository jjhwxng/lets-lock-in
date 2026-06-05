const express = require('express');
const mysql = require('mysql2');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'lets_lock_in',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306
});

// Main page
app.get('/', (req, res) => {
    const now = new Date();

    const formattedDate = now.toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric'
    });

    const weekday = now.toLocaleDateString('en-US', {
        weekday: 'long'
    });

    res.render('index', {
        title: "Let's Lock In",
        date: formattedDate,
        weekday: weekday
    });
});

// Retrieval endpoint: tasks
app.get('/api/tasks', (req, res) => {
    const userId = req.query.userId;
    let query = `
        SELECT TaskID, TaskName, Priority, EstimatedTime
        FROM Task
    `;
    const params = [];

    if (userId) {
        query += ` WHERE UserID = ?`;
        params.push(userId);
    }

    query += ` ORDER BY TaskID DESC LIMIT 10`;

    db.query(query, params, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to retrieve tasks' });
        }
        res.json(results);
    });
});

// Retrieval endpoint: classes
app.get('/api/classes', (req, res) => {
    const query = `
        SELECT ClassID, ClassName, StartTime, EndTime, Days
        FROM \`Class\`
        ORDER BY StartTime ASC
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Failed to retrieve classes' });
        }
        res.json(results);
    });
});

// users
app.get('/api/users', (req, res) => {
    db.query('SELECT DISTINCT UserID FROM Task WHERE UserID IS NOT NULL ORDER BY UserID', (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch users' });
        res.json(results);
    });
});

// Retrieval endpoint: keyword search
app.get('/api/search-tasks', (req,res)=> {
    const keyword=req.query.q;
    if(!keyword)
    {
        return res.status(400).json({error: "No matching keyword"});
    }

    const query = `
        SELECT TaskID, TaskName, Priority, EstimatedTime
        FROM Task
        WHERE TaskName LIKE ?
        ORDER BY Priority
    `;

    db.query(query, [`%${keyword}%`], (err, results) => {
        if (err) {
            console.error("SEARCH ERROR:", err);
            return res.status(500).json({ error: "Search failed" });
        }

        res.json(results);
    });
});

// Add task
app.post('/api/tasks', (req, res) => {
    const { TaskName, Priority, EstimatedTime, UserID, ClassID } = req.body;

    db.query('SELECT MAX(TaskID) AS maxId FROM Task', (err, result) => {
        if (err) {
            console.error("MAX ID ERROR:", err);
            return res.status(500).json({ error: 'Failed to create task' });
        }

        const newTaskId = (result[0].maxId || 0) + 1;

        const query = `
            INSERT INTO Task (TaskID, TaskName, Priority, EstimatedTime, UserID, ClassID)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(
            query,
            [newTaskId, TaskName, Priority, EstimatedTime, UserID || null, ClassID || null],
            (err) => {
                if (err) {
                    console.error("CREATE ERROR:", err);
                    return res.status(500).json({
                        error: 'Create failed',
                        message: err.message
                    });
                }

                res.json({
                    message: 'Task created',
                    TaskID: newTaskId
                });
            }
        );
    });
});

// Delete task
app.delete('/api/tasks/:id', (req, res) => {
    const taskId = req.params.id;

    const query = `
        DELETE FROM Task
        WHERE TaskID = ?
    `;

    db.query(query, [taskId], (err) => {
        if (err) {
            console.error("DELETE ERROR:", err);
            return res.status(500).json({
                error: "Delete failed",
                message: err.message
            });
        }

        res.json({ message: "Task deleted" });
    });
});

// Update task
app.put('/api/tasks/:id', (req, res) => {
    const taskId = req.params.id;
    const { TaskName, Priority, EstimatedTime } = req.body;

    const query = `
        UPDATE Task
        SET TaskName = ?, Priority = ?, EstimatedTime = ?
        WHERE TaskID = ?
    `;

    db.query(query, [TaskName, Priority, EstimatedTime, taskId], (err) => {
        if (err) {
            console.error("UPDATE ERROR:", err);
            return res.status(500).json({
                error: "Update failed",
                message: err.message
            });
        }

        res.json({ message: "Task updated" });
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

// Generate schedule
app.post('/api/generate-schedule', (req, res) => {
    const { UserID } = req.body;

    const query = `CALL GenerateDailySchedule(?)`;

    db.query(query, [UserID], (err, results) => {
        if (err) {
            console.error("PROC ERROR:", err);
            return res.status(500).json({
                error: "Schedule generation failed",
                message: err.message
            });
        }

        res.json({ message: "Schedule generated successfully" });
    });
});

// Get latest schedule
app.get('/api/schedule', (req, res) => {
    const { userId } = req.query;

    const query = `
        SELECT B.Start, B.End, 
               COALESCE(T.TaskName, 'Class') AS TaskName, 
               COALESCE(T.Priority, 0) AS Priority,
               B.ClassID,
               CASE WHEN T.TaskID IS NULL THEN 1 ELSE 0 END AS IsClass
        FROM Blocks B
        LEFT JOIN Task T ON B.TaskID = T.TaskID
        WHERE B.ScheduleID = (
            SELECT ScheduleID
            FROM Schedule
            WHERE Date = CURDATE()
            LIMIT 1
        )
        ORDER BY B.Start
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error("FETCH ERROR:", err);
            return res.status(500).json({ error: "Failed to fetch schedule" });
        }
        res.json(results);
    });
});

app.get('/api/statistics', (req, res) => {
    db.query('CALL GenerateStudentStatistics()', (err, results) => {
        if (err) {
            console.error("STATS ERROR:", err);
            return res.status(500).json({
                error: 'Failed to generate statistics',
                message: err.message
            });
        }

        res.json({
            AboveAvgWorkload: results[0],
            MajorWorkload: results[1]
        });
    });
});

