(() => {
  const deadlineDate = new Date(window.countdownDeadline).getTime();

  const countdownDays = document.querySelector('.countdown__days .number');
  const countdownHours = document.querySelector('.countdown__hours .number');
  const countdownMinutes = document.querySelector('.countdown__minutes .number');
  const countdownSeconds = document.querySelector('.countdown__seconds .number');

  setInterval(() => {
    const now = new Date().getTime();
    const distance = deadlineDate - now;

    const days = Math.floor(distance / (1000 * 60 * 60 * 24));
    const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((distance % (1000 * 60)) / 1000);

    countdownDays.textContent = days;
    countdownHours.textContent = hours;
    countdownMinutes.textContent = minutes;
    countdownSeconds.textContent = seconds;
  }, 1000);
})();
