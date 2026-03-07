import app from './app';

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Axia backend running on port ${PORT}`);
});
